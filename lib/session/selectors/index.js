import debugModule from "debug";
const debug = debugModule("debugger:session:selectors");

import { createSelectorTree, createLeaf } from "reselect-tree";

import evm from "../../evm/selectors";
import solidity from "../../solidity/selectors";

const session = createSelectorTree({
  /**
   * session.info
   */
  info: {

    /**
     * session.info.affectedInstances
     */
    affectedInstances: createLeaf(
      [evm.info.instances, evm.info.contexts, solidity.info.sources, solidity.info.sourceMaps],

      (instances, contexts, sources, sourceMaps) => Object.assign({},
        ...Object.entries(instances).map(
          ([address, { context }]) => {
            debug("instances %O", instances);
            debug("contexts %O", contexts);
            let { contractName, binary } = contexts[context];
            let { sourceMap } = sourceMaps[context] || {};

            let { source } = sourceMap ?
              // look for source ID between second and third colons (HACK)
              sources[sourceMap.match(/^[^:]+:[^:]+:([^:]+):/)[1]] :
              {};

            return {
              [address]: {
                contractName, source, binary
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
    _: (state) => state.session.transaction,

    /**
     * session.transaction.receipt
     * contains the ethers receipt object
     */
    receipt: (state) => state.session.receipt,

  }

});

export default session;
