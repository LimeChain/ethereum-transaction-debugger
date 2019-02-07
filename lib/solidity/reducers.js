import { combineReducers } from "redux";

import { keccak256 } from "../helpers";

import * as actions from "./actions";

const DEFAULT_SOURCES = {
  byId: {}
};

function sources(state = DEFAULT_SOURCES, action) {
  switch (action.type) {
    /*
     * Adding a new source
     */
    case actions.ADD_SOURCE:
      let { ast, source, sourcePath, compiler } = action;

      let id = Object.keys(state.byId).length;

      return {
        byId: {
          ...state.byId,

          [id]: {
            id,
            ast,
            source,
            sourcePath,
            compiler
          }
        }
      };

    /*
     * Default case
     */
    default:
      return state;
  }
}

const DEFAULT_SOURCEMAPS = {
  byContext: {}
};

function sourceMaps(state = DEFAULT_SOURCEMAPS, action) {
  switch (action.type) {
    /*
     * Adding a new sourceMap
     */
    case actions.ADD_SOURCEMAP:
      let { binary, sourceMap } = action;
      let context = keccak256(binary);

      return {
        byContext: {
          ...state.byContext,

          [context]: {
            context,
            sourceMap
          }
        }
      };

    /*
     * Default Case
     */
    default:
      return state;
  }
}

const info = combineReducers({
  sources,
  sourceMaps
});

export function functionDepth(state = 0, action) {
  switch (action.type) {
    case actions.JUMP:
      const delta = spelunk(action.jumpDirection);
      return state + delta;

    case actions.RESET:
      return 0;

    default:
      return state;
  }
}

function spelunk(jump) {
  if (jump === "i") {
    return 1;
  } else if (jump === "o") {
    return -1;
  } else if (jump === "2") {
    return 2; //HACK WORKAROUND
  } else {
    return 0;
  }
}

const proc = combineReducers({
  functionDepth
});

const reducer = combineReducers({
  info,
  proc
});

export default reducer;
