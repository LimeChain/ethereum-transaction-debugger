const { combineReducers } = require("redux");

const action = require("./actions");

const { keccak256 } = require("../helpers");

const DEFAULT_CONTEXTS = {
  byContext: {},
  byBinary: {}
};

function contexts(state = DEFAULT_CONTEXTS, action) {
  switch (action.type) {
    /*
     * Adding a new context
     */
    case actions.ADD_CONTEXT: {
      const { contractName, raw, compiler } = action;
      const context = keccak256(raw);

      return {
        ...state,

        byContext: {
          ...state.byContext,

          [context]: {
            ...(state.byContext[context] || {}),

            contractName,
            context,
            compiler
          }
        }
      };
    }

    /*
     * Adding binary for a context
     */
    case actions.ADD_BINARY: {
      const { context, binary } = action;

      if (state.byBinary[binary]) {
        return state;
      }

      return {
        byContext: {
          ...state.byContext,

          [context]: {
            ...state.byContext[context],

            binary
          }
        },

        byBinary: {
          ...state.byBinary,

          [binary]: { context: context }
        }
      };
    }

    /*
     * Default case
     */
    default:
      return state;
  }
}

const DEFAULT_INSTANCES = {
  byAddress: {},
  byContext: {}
};

function instances(state = DEFAULT_INSTANCES, action) {
  switch (action.type) {
    /*
     * Adding a new address for context
     */
    case actions.ADD_INSTANCE:
      let { address, context, binary } = action;

      address = address.toLowerCase();

      // get known addresses for this context
      let otherInstances = state.byContext[context] || [];
      let otherAddresses = otherInstances.map(({ address }) => address);

      return {
        byAddress: {
          ...state.byAddress,

          [address]: { address, context, binary }
        },

        byContext: {
          ...state.byContext,

          // reconstruct context instances to include new address
          [context]: Array.from(new Set(otherAddresses).add(address)).map(
            address => ({ address })
          )
        }
      };

    /*
     * Default case
     */
    default:
      return state;
  }
}

const info = combineReducers({
  contexts,
  instances
});

export function callstack(state = [], action) {
  switch (action.type) {
    case actions.CALL:
      let address = action.address.toLowerCase();
      //we get some addresses in lowercase, some in checksum case,
      //so I'm lowercasing them all for consistency
      return state.concat([{ address }]);

    case actions.CREATE:
      const binary = action.binary;
      return state.concat([{ binary }]);

    case actions.RETURN:
      //HACK: pop the stack, UNLESS that would leave it empty (this will only
      //happen at the end when we want to keep the last one around)
      return state.length > 1 ? state.slice(0, -1) : state;

    case action.RESET:
      return [state[0]]; //leave the initial call still on the stack

    default:
      return state;
  }
}

const proc = combineReducers({
  callstack
});

const reducer = combineReducers({
  info,
  proc
});

export default reducer;
