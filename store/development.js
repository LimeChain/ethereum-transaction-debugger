
const debugModule = require("debug");

const debug = debugModule("debugger:store:development");

const { composeWithDevTools } = require("remote-redux-devtools");

const commonConfigure = require("./common");

export default function configureStore(reducer, saga, initialState) {
  const composeEnhancers = composeWithDevTools({
    realtime: false,
    actionsBlacklist: [
      "RECEIVE_TRACE", "SCOPE", "DECLARE_VARIABLE",
      "ASSIGN", "ADVANCE", "SAVE_STEPS", "BEGIN_STEP", "NEXT"
    ],
    stateSanitizer: (state) => ({
      // session: state.session,
      // context: state.context,
      // evm: state.evm,
      // solidity: state.solidity,
      // data: state.data,
    }),

    startOn: "SESSION_READY",
    name: "ethereum-debugger",
    hostname: "localhost",
    port: 11117,
  });
  return commonConfigure(reducer, saga, initialState, composeEnhancers);
}
