const debugModule = require("debug");

const debug = debugModule("debugger:controller:sagas");

const { createSelectorTree, createLeaf } = require("reselect-tree");

const evm = require("../../evm/selectors");

const solidity = require("../../solidity/selectors");

const ast = require("../../ast/selectors");

const trace = require("../../trace/selectors");

/**
 * @private
 */
const identity = (x) => x;

/**
 * controller
 */
const controller = createSelectorTree({

  /**
   * controller.state
   */
  state: ((state) => state.controller),
  /**
   * controller.current
   */
  current: {
    /**
     * controller.current.functionDepth
     */
    functionDepth: createLeaf([solidity.current.functionDepth], identity),

    /**
     * controller.current.executionContext
     */
    executionContext: createLeaf([evm.current.call], identity),

    /**
     * controller.current.willJump
     */
    willJump: createLeaf([evm.current.step.isJump], identity),

    /**
     * controller.current.location
     */
    location: {
      /**
       * controller.current.location.sourceRange
       */
      sourceRange: createLeaf([solidity.current.sourceRange], identity),

      /**
       * controller.current.location.source
       */
      source: createLeaf([solidity.current.source], identity),

      /**
       * controller.current.location.node
       */
      node: createLeaf([ast.current.node], identity),

      /**
       * controller.current.location.isMultiline
       */
      isMultiline: createLeaf([solidity.current.isMultiline], identity),
    }
  },

  /**
   * controller.breakpoints
   */
  breakpoints: createLeaf(["./state"], (state) => state.breakpoints),

  /**
   * controller.finished
   */
  finished: createLeaf([trace.finished], identity),

});

export default controller;
