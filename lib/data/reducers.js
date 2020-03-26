import debugModule from "debug";
const debug = debugModule("debugger:data:reducers");

import { combineReducers } from "redux";

import { makeAssignment } from "../helpers";

import * as actions from "./actions";

const DEFAULT_SCOPES = {
  byCompilationId: {}
};

function scopes(state = DEFAULT_SCOPES, action) {
  let scope;
  let newState;
  let variables;

  switch (action.type) {
    case actions.SCOPE: {
      let { compilationId, id, sourceId, parentId, pointer } = action;

      debug("action: %O", action);

      newState = {
        byCompilationId: {
          ...state.byCompilationId,
          [compilationId]: {
            ...state.byCompilationId[compilationId] //just setting this up to avoid errors later
          }
        }
      };

      //apologies for this multi-stage setup, but JS is like that...

      newState.byCompilationId[compilationId] = {
        byId: {
          ...newState.byCompilationId[compilationId].byId
        }
      };

      scope = newState.byCompilationId[compilationId].byId[id];

      newState.byCompilationId[compilationId].byId[id] = {
        ...scope,
        id,
        sourceId,
        parentId,
        pointer,
        compilationId
      };

      return newState;
    }
    case actions.DECLARE: {
      let { compilationId, node } = action;

      //note: we can assume the compilation already exists!
      scope =
        state.byCompilationId[compilationId].byId[action.node.scope] || {};
      variables = scope.variables || [];

      return {
        byCompilationId: {
          ...state.byCompilationId,
          [compilationId]: {
            byId: {
              ...state.byCompilationId[compilationId].byId,

              [node.scope]: {
                ...scope,

                variables: [
                  ...variables,

                  {
                    name: node.name,
                    id: node.id,
                    compilationId
                  }
                ]
              }
            }
          }
        }
      };
    }
    default:
      return state;
  }
}

//a note on the following reducer: solidity assigns a unique AST ID to every
//AST node among all the files being compiled together.  thus, it is, for now,
//safe to identify user-defined types solely by their AST ID.  In the future,
//once we eventually support having some files compiled separately from others,
//this will become a bug you'll have to fix, and you'll have to fix it in the
//decoder, too.  Sorry, future me! (or whoever's stuck doing this)

function userDefinedTypes(state = [], action) {
  switch (action.type) {
    case actions.DEFINE_TYPE:
      return [
        ...state,
        { id: action.node.id, compilationId: action.compilationId }
      ];
    default:
      return state;
  }
}

const DEFAULT_ALLOCATIONS = {
  storage: {},
  memory: {},
  abi: {},
  state: {}
};

function allocations(state = DEFAULT_ALLOCATIONS, action) {
  if (action.type === actions.ALLOCATE) {
    return {
      storage: action.storage,
      memory: action.memory,
      abi: action.abi,
      state: action.state
    };
  } else {
    return state; //not to be confused with action.state!
  }
}

const info = combineReducers({
  scopes,
  userDefinedTypes,
  allocations
});

const GLOBAL_ASSIGNMENTS = [
  [{ builtin: "msg" }, { location: "special", special: "msg" }],
  [{ builtin: "tx" }, { location: "special", special: "tx" }],
  [{ builtin: "block" }, { location: "special", special: "block" }],
  [{ builtin: "this" }, { location: "special", special: "this" }],
  [{ builtin: "now" }, { location: "special", special: "timestamp" }] //we don't have an alias "now"
].map(([idObj, ref]) => makeAssignment(idObj, ref));

const DEFAULT_ASSIGNMENTS = {
  byId: Object.assign(
    {}, //we start out with all globals assigned
    ...GLOBAL_ASSIGNMENTS.map(assignment => ({ [assignment.id]: assignment }))
  ),
  byCompilationId: {}, //no regular variables assigned at start
  byBuiltin: Object.assign(
    {}, //again, all globals start assigned
    ...GLOBAL_ASSIGNMENTS.map(assignment => ({
      [assignment.builtin]: [assignment.id] //yes, that's a 1-element array
    }))
  )
};

function assignments(state = DEFAULT_ASSIGNMENTS, action) {
  switch (action.type) {
    case actions.ASSIGN:
    case actions.MAP_PATH_AND_ASSIGN:
      debug("action.type %O", action.type);
      debug("action.assignments %O", action.assignments);
      return Object.values(action.assignments).reduce((acc, assignment) => {
        let { id, astId, compilationId } = assignment;
        //we assume for now that only ordinary variables will be assigned this
        //way, and not globals; globals are handled in DEFAULT_ASSIGNMENTS
        return {
          ...acc,
          byId: {
            ...acc.byId,
            [id]: assignment
          },
          byCompilationId: {
            ...acc.byCompilationId,
            [compilationId]: {
              byAstId: {
                ...(acc.byCompilationId[compilationId] || {}).byAstId,
                [astId]: [
                  ...new Set([
                    ...((acc.byCompilationId[compilationId] || { byAstId: {} })
                      .byAstId[astId] || []),
                    id
                  ])
                ]
              }
            }
          }
        };
      }, state);

    case actions.RESET:
      return DEFAULT_ASSIGNMENTS;

    default:
      return state;
  }
}

const DEFAULT_PATHS = {
  byAddress: {}
};

//WARNING: do *not* rely on mappedPaths to keep track of paths that do not
//involve mapping keys!  Yes, many will get mapped, but there is no guarantee.
//Only when mapping keys are involved does it necessarily work reliably --
//which is fine, as that's all we need it for.
function mappedPaths(state = DEFAULT_PATHS, action) {
  switch (action.type) {
    case actions.MAP_PATH_AND_ASSIGN:
      let { address, slot, typeIdentifier, parentType } = action;
      //how this case works: first, we find the spot in our table (based on
      //address, type identifier, and slot address) where the new entry should
      //be added; if needed we set up all the objects needed along the way.  If
      //there's already something there, we do nothing.  If there's nothing
      //there, we record our given slot in that spot in that table -- however,
      //we alter it in one key way.  Before entry, we check if the slot's
      //*parent* has a spot in the table, based on address (same for both child
      //and parent), parentType, and the parent's slot address (which can be
      //found as the slotAddress of the slot's path object, if it exists -- if
      //it doesn't then we conclude that no the parent does not have a spot in
      //the table).  If the parent has a slot in the table already, then we
      //alter the child slot by replacing its path with the parent slot.  This
      //will keep the slotAddress the same, but since the versions kept in the
      //table here are supposed to preserve path information, we'll be
      //replacing a fairly bare-bones Slot object with one with a full path.

      //we do NOT want to distinguish between types with and without "_ptr" on
      //the end here! (or _slice)
      debug("typeIdentifier %s", typeIdentifier);
      typeIdentifier = Codec.Ast.Utils.regularizeTypeIdentifier(typeIdentifier);
      parentType = Codec.Ast.Utils.regularizeTypeIdentifier(parentType);

      debug("slot %o", slot);
      let hexSlotAddress = Codec.Conversion.toHexString(
        Codec.Storage.Utils.slotAddress(slot),
        Codec.Evm.Utils.WORD_SIZE
      );
      let parentAddress = slot.path
        ? Codec.Conversion.toHexString(
            Codec.Storage.Utils.slotAddress(slot.path),
            Codec.Evm.Utils.WORD_SIZE
          )
        : undefined;

      //this is going to be messy and procedural, sorry.  but let's start with
      //the easy stuff: create the new address if needed, clone if not
      let newState = {
        ...state,
        byAddress: {
          ...state.byAddress,
          [address]: {
            byType: {
              ...(state.byAddress[address] || { byType: {} }).byType
            }
          }
        }
      };

      //now, let's add in the new type, if needed
      newState.byAddress[address].byType = {
        ...newState.byAddress[address].byType,
        [typeIdentifier]: {
          bySlotAddress: {
            ...(
              newState.byAddress[address].byType[typeIdentifier] || {
                bySlotAddress: {}
              }
            ).bySlotAddress
          }
        }
      };

      let oldSlot =
        newState.byAddress[address].byType[typeIdentifier].bySlotAddress[
          hexSlotAddress
        ];
      //yes, this looks strange, but we haven't changed it yet except to
      //clone or create empty (and we don't want undefined!)
      //now: is there something already there or no?  if no, we must add
      if (oldSlot === undefined) {
        let newSlot;
        debug("parentAddress %o", parentAddress);
        if (
          parentAddress !== undefined &&
          newState.byAddress[address].byType[parentType] &&
          newState.byAddress[address].byType[parentType].bySlotAddress[
            parentAddress
          ]
        ) {
          //if the parent is already present, use that instead of the given
          //parent!
          newSlot = {
            ...slot,
            path:
              newState.byAddress[address].byType[parentType].bySlotAddress[
                parentAddress
              ]
          };
        } else {
          newSlot = slot;
        }
        newState.byAddress[address].byType[typeIdentifier].bySlotAddress[
          hexSlotAddress
        ] = newSlot;
      }
      //if there's already something there, we don't need to do anything

      return newState;

    case actions.RESET:
      return DEFAULT_PATHS;

    default:
      return state;
  }
}

const proc = combineReducers({
  assignments,
  mappedPaths
});

const reducer = combineReducers({
  info,
  proc
});

export default reducer;