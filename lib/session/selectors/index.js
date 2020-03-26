import debugModule from "debug";
const debug = debugModule("debugger:session:selectors");

import { createSelectorTree, createLeaf } from "reselect-tree";

import evm from "../../evm/selectors";
import trace from "../../trace/selectors";
import solidity from "../../solidity/selectors";

const session = createSelectorTree({
  /*
   * session.state
   */
  state: state => state.session,

  /**
   * session.info
   */
  info: {
    /**
     * session.info.affectedInstances
     */
    affectedInstances: createLeaf(
      [evm.current.codex.instances, evm.info.contexts, solidity.info.sources],

      (instances, contexts, sources) =>
        Object.assign(
          {},
          ...Object.entries(instances).map(
            ([address, { context: contextId, binary }]) => {
              debug("instances %O", instances);
              debug("contexts %O", contexts);
              let context = contexts[contextId];
              if (!context) {
                return { [address]: { binary } };
              }
              let { contractName, compilationId, primarySource } = context;

              let source =
                primarySource !== undefined
                  ? sources[compilationId].byId[primarySource]
                  : undefined;

              return {
                [address]: {
                  contractName,
                  source,
                  binary
                }
              };
            }
          )
        )
    )
  },

  /**
   * session.transaction (namespace)
   */
  transaction: {
    /**
     * session.transaction (selector)
     * contains the ethers transaction object
     */
    _: createLeaf(["/state"], state => state.transaction),

    /**
     * session.transaction.receipt
     * contains the ethers receipt object
     */
    receipt: createLeaf(["/state"], state => state.receipt),

    /**
     * session.transaction.block
     * contains the ethers block object
     */
    block: createLeaf(["/state"], state => state.block)
  },

  /*
   * session.status (namespace)
   */
  status: {
    /*
     * session.status.readyOrError
     */
    readyOrError: createLeaf(["/state"], state => state.ready),

    /*
     * session.status.ready
     */
    ready: createLeaf(
      ["./readyOrError", "./isError"],
      (readyOrError, error) => readyOrError && !error
    ),

    /*
     * session.status.waiting
     */
    waiting: createLeaf(["/state"], state => !state.ready),

    /*
     * session.status.error
     */
    error: createLeaf(["/state"], state => state.lastLoadingError),

    /*
     * session.status.isError
     */
    isError: createLeaf(["./error"], error => error !== null),

    /*
     * session.status.success
     */
    success: createLeaf(["./error"], error => error === null),

    /*
     * session.status.errored
     */
    errored: createLeaf(
      ["./readyOrError", "./isError"],
      (readyOrError, error) => readyOrError && error
    ),

    /*
     * session.status.loaded
     */
    loaded: createLeaf([trace.loaded], loaded => loaded)
  }
});

export default session;