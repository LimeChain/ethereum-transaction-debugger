const debugModule = require("debug");

const debug = debugModule("debugger:solidity:selectors");

const { createSelectorTree, createLeaf } = require("reselect-tree");
const SolidityUtils = require("truffle-solidity-utils");
const CodeUtils = require("truffle-code-utils");

const TruffleDecodeUtils = require("truffle-decode-utils");

const { findRange } = require("../../ast/map");

const jsonpointer = require("json-pointer");

const evm = require("../../evm/selectors");

const semver = require("semver");

function getSourceRange(instruction = {}) {
  return {
    start: instruction.start || 0,
    length: instruction.length || 0,
    lines: instruction.range || {
      start: {
        line: 0,
        column: 0
      },
      end: {
        line: 0,
        column: 0
      }
    }
  };
}

let solidity = createSelectorTree({
  /**
   * solidity.state
   */
  state: state => state.solidity,

  /**
   * solidity.info
   */
  info: {
    /**
     * solidity.info.sources
     */
    sources: createLeaf(["/state"], state => state.info.sources.byId),

    /**
     * solidity.info.sourceMaps
     */
    sourceMaps: createLeaf(["/state"], state => state.info.sourceMaps.byContext)
  },

  /**
   * solidity.current
   */
  current: {
    /**
     * solidity.current.sourceMap
     */
    sourceMap: createLeaf(
      [evm.current.context, "/info/sourceMaps"],

      ({ context }, sourceMaps) => sourceMaps[context] || {}
    ),

    /**
     * solidity.current.functionDepth
     */
    functionDepth: state => state.solidity.proc.functionDepth,

    /**
     * solidity.current.instructions
     */
    instructions: createLeaf(
      ["/info/sources", evm.current.context, "./sourceMap"],

      (sources, { binary }, { sourceMap }) => {
        if (!binary) {
          return [];
        }

        let instructions = CodeUtils.parseCode(binary);

        if (!sourceMap) {
          // Let's create a source map to use since none exists. This source map
          // maps just as many ranges as there are instructions, and ensures every
          // instruction is marked as "jumping out". This will ensure all
          // available debugger commands step one instruction at a time.
          //
          // This is kindof a hack; perhaps this should be broken out into separate
          // context types. TODO
          sourceMap = "";
          for (var i = 0; i < instructions.length; i++) {
            sourceMap += i + ":" + i + ":1:-1;";
          }
        }

        var lineAndColumnMappings = Object.assign(
          {},
          ...Object.entries(sources).map(([id, { source }]) => ({
            [id]: SolidityUtils.getCharacterOffsetToLineAndColumnMapping(
              source || ""
            )
          }))
        );
        var humanReadableSourceMap = SolidityUtils.getHumanReadableSourceMap(
          sourceMap
        );

        let primaryFile = humanReadableSourceMap[0].file;
        debug("primaryFile %o", primaryFile);

        return instructions
          .map((instruction, index) => {
            // lookup source map by index and add `index` property to
            // instruction
            //

            const sourceMap = humanReadableSourceMap[index] || {};

            return {
              instruction: { ...instruction, index },
              sourceMap
            };
          })
          .map(({ instruction, sourceMap }) => {
            // add source map information to instruction, or defaults
            //

            const {
              jump,
              start = 0,
              length = 0,
              file = primaryFile
            } = sourceMap;
            const lineAndColumnMapping = lineAndColumnMappings[file] || {};
            const range = {
              start: lineAndColumnMapping[start] || {
                line: null,
                column: null
              },
              end: lineAndColumnMapping[start + length] || {
                line: null,
                column: null
              }
            };

            if (range.start.line === null) {
              debug("sourceMap %o", sourceMap);
            }

            return {
              ...instruction,

              jump,
              start,
              length,
              file,
              range
            };
          });
      }
    ),

    /**
     * solidity.current.instructionAtProgramCounter
     */
    instructionAtProgramCounter: createLeaf(
      ["./instructions"],

      instructions => {
        let map = [];
        instructions.forEach(function (instruction) {
          map[instruction.pc] = instruction;
        });

        // fill in gaps in map by defaulting to the last known instruction
        let lastSeen = null;
        for (let [pc, instruction] of map.entries()) {
          if (instruction) {
            lastSeen = instruction;
          } else {
            map[pc] = lastSeen;
          }
        }
        return map;
      }
    ),

    /**
     * solidity.current.instruction
     */
    instruction: createLeaf(
      ["./instructionAtProgramCounter", evm.current.step.programCounter],

      (map, pc) => map[pc] || {}
    ),

    /**
     * solidity.current.source
     */
    source: createLeaf(
      ["/info/sources", "./instruction"],

      (sources, { file: id }) => sources[id] || {}
    ),

    /**
     * solidity.current.sourceRange
     */
    sourceRange: createLeaf(["./instruction"], getSourceRange),

    /**
     * solidity.current.isSourceRangeFinal
     */
    isSourceRangeFinal: createLeaf(
      [
        "./instructionAtProgramCounter",
        evm.current.step.programCounter,
        evm.next.step.programCounter
      ],

      (map, current, next) => {
        if (!map[next]) {
          return true;
        }

        current = map[current];
        next = map[next];

        return (
          current.start != next.start ||
          current.length != next.length ||
          current.file != next.file
        );
      }
    ),

    /**
     * solidity.current.isMultiline
     */
    isMultiline: createLeaf(
      ["./sourceRange"],

      ({ lines }) => lines.start.line != lines.end.line
    ),

    /**
     * solidity.current.willJump
     */
    willJump: createLeaf([evm.current.step.isJump], isJump => isJump),

    /**
     * solidity.current.jumpDirection
     */
    jumpDirection: createLeaf(["./instruction"], (i = {}) => i.jump || "-"),

    /**
     * solidity.current.willCall
     */
    willCall: createLeaf([evm.current.step.isCall], x => x),

    /**
     * solidity.current.willCreate
     */
    willCreate: createLeaf([evm.current.step.isCreate], x => x),

    /**
     * solidity.current.callsPrecompile
     */
    callsPrecompile: createLeaf([evm.current.step.callsPrecompile], x => x),

    /**
     * solidity.current.willReturn
     */
    willReturn: createLeaf(
      [evm.current.step.isHalting],
      isHalting => isHalting
    ),

    //HACK: DUPLICATE CODE FOLLOWS
    //The following code duplicates some selectors in ast.
    //This exists to suppor the solidity.current.contractCall workaround below.
    //This should be cleaned up later.

    /**
     * solidity.current.pointer
     * HACK duplicates ast.current.pointer
     */
    pointer: createLeaf(
      ["./source", "./sourceRange"],

      ({ ast }, range) => findRange(ast, range.start, range.length)
    ),

    /**
     * solidity.current.node
     * HACK duplicates ast.current.node
     */
    node: createLeaf(
      ["./source", "./pointer"],
      ({ ast }, pointer) =>
        pointer ? jsonpointer.get(ast, pointer) : jsonpointer.get(ast, "")
    ),

    /**
     * solidity.current.isContractCall
     * HACK WORKAROUND (only applies to solc version <0.5.1)
     * this selector exists to work around a problem in solc
     * it attempts to detect whether the current node is a contract method call
     * (or library method call)
     * it will not successfully detect this if the method was first placed in a
     * function variable, only if it is being called directly
     */
    isContractCall: createLeaf(
      ["./node"],
      node =>
        node !== undefined &&
        node.nodeType === "FunctionCall" &&
        node.expression !== undefined &&
        node.expression.nodeType === "MemberAccess" &&
        node.expression.expression !== undefined &&
        (TruffleDecodeUtils.Definition.isContract(node.expression.expression) ||
          TruffleDecodeUtils.Definition.isContractType(
            node.expression.expression
          ))
    ),

    /**
     * solidity.current.needsFunctionDepthWorkaround
     * HACK
     * Determines if the solidity version used for the contract about to be
     * called was <0.5.1, to determine whether to use the above workaround
     * Only call this if the current step is a call or create!
     */
    needsFunctionDepthWorkaround: createLeaf(
      [evm.current.step.callContext],
      context =>
        context.compiler !== undefined && //would be undefined for e.g. a precompile
        context.compiler.name === "solc" &&
        semver.satisfies(context.compiler.version, "<0.5.1")
    )
  }
});

export default solidity;
