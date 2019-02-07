const debugModule = require("debug");

const debug = debugModule("debugger:ast:selectors");

const { createSelectorTree, createLeaf } = require("reselect-tree");

const jsonpointer = require("json-pointer");

const solidity = require("../../solidity/selectors");

const { findRange } = require("../map");


/**
 * ast
 */
const ast = createSelectorTree({
  /**
   * ast.views
   */
  views: {
    /**
     * ast.views.sources
     */
    sources: createLeaf([solidity.info.sources], sources => sources)
  },

  /**
   * ast.current
   */
  current: {

    /**
     * ast.current.tree
     *
     * ast for current source
     */
    tree: createLeaf(
      [solidity.current.source], ({ ast }) => ast
    ),

    /**
     * ast.current.index
     *
     * source ID
     */
    index: createLeaf(
      [solidity.current.source], ({ id }) => id
    ),

    /**
     * ast.current.pointer
     *
     * jsonpointer for current ast node
     */
    pointer: createLeaf(
      ["./tree", solidity.current.sourceRange],

      (ast, range) => findRange(ast, range.start, range.length)
    ),

    /**
     * ast.current.node
     *
     * current ast node to execute
     */
    node: createLeaf(
      ["./tree", "./pointer"], (ast, pointer) =>
        (pointer)
          ? jsonpointer.get(ast, pointer)
          : jsonpointer.get(ast, "")
    ),

  }
});

export default ast;
