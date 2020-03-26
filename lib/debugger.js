import debugModule from 'debug';

import Session from "./session";

import { createNestedSelector } from "reselect-tree";

import dataSelector from "./data/selectors";
import astSelector from "./ast/selectors";
import traceSelector from "./trace/selectors";
import evmSelector from "./evm/selectors";
import soliditySelector from "./solidity/selectors";
import sessionSelector from "./session/selectors";
import controllerSelector from "./controller/selectors";

const debug = debugModule("debugger");

import { Compilations } from "@truffle/codec";


var expect = {
  options: function (options, expected_keys) {
    expected_keys.forEach(function (key) {
      if (options[key] == null) {
        throw new Error(`Expected parameter "${key}" not passed to function.`);
      }
    });
  },

  one: function (options, expected_keys) {
    var found = [];

    expected_keys.forEach(function (key) {
      if (options[key] != null) {
        found.push(1);
      } else {
        found.push(0);
      }
    });

    var total = found.reduce(function (t, value) {
      return t + value;
    });

    if (total >= 1) return;

    throw new Error(`Expected one of the following parameters, but found none: ${expected_keys.join(", ")}`);
  }
}

/**
 * @example
 * let session = Debugger
 *   .forTx(<txHash>, {
 *     contracts: [<contract obj>, ...],
 *     provider: <provider instance>
 *   })
 *   .connect();
 */
export default class Debugger {
  /**
   * @param {Session} session - debugger session
   * @private
   */
  constructor(session) {
    /**
     * @private
     */
    this._session = session;
  }

  /**
   * Instantiates a Debugger for a given transaction hash.
   *
   * @param {String} txHash - transaction hash with leading "0x"
   * @param {{contracts: Array<Contract>, files: Array<String>, provider: EthersJSProvider, compilations: Array<Compilation>}} options -
   * @return {Debugger} instance
   */
  static async forTx(txHash, options = {}) {
    let { contracts, files, provider, compilations } = options;
    if (!compilations) {
      compilations = Compilations.Utils.shimArtifacts(contracts, files);
    }

    let session = new Session(compilations, provider, txHash);

    try {
      await session.ready();
      debug("session ready");
    } catch (e) {
      debug("error occurred, unloaded");
      session.unload();
    }

    return new this(session);
  }


  /**
   * Connects to the instantiated Debugger.
   *
   * @return {Session} session instance
   */
  connect() {
    return this._session;
  }

  /**
   * Exported selectors
   *
   * See individual selector docs for full listing
   *
   * @example
   * Debugger.selectors.ast.current.tree
   *
   * @example
   * Debugger.selectors.solidity.current.instruction
   *
   * @example
   * Debugger.selectors.trace.steps
   */
  static get selectors() {
    return createNestedSelector({
      ast: astSelector,
      data: dataSelector,
      trace: traceSelector,
      evm: evmSelector,
      solidity: soliditySelector,
      session: sessionSelector,
      controller: controllerSelector,
    });
  }
}

/**
 * @typedef {Object} Contract
 * @property {string} contractName contract name
 * @property {string} source solidity source code
 * @property {string} sourcePath path to source file
 * @property {string} binary 0x-prefixed hex string with create bytecode
 * @property {string} sourceMap solidity source map for create bytecode
 * @property {Object} ast Abstract Syntax Tree from Solidity
 * @property {string} deployedBinary 0x-prefixed compiled binary (on chain)
 * @property {string} deployedSourceMap solidity source map for on-chain bytecode
 */
