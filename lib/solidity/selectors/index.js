import debugModule from "debug";
const debug = debugModule("debugger:solidity:selectors");

import { createSelectorTree, createLeaf } from "reselect-tree";
import SolidityUtils from "@truffle/solidity-utils";
import CodeUtils from "@truffle/code-utils";
import * as Codec from "@truffle/codec";

import IntervalTree from "node-interval-tree";
import jsonpointer from "json-pointer";
import semver from "semver";
import { getRange } from "../../helpers";

import evm from "../../evm/selectors";
import trace from "../../trace/selectors";

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

function contextRequiresPhantomStackframes(context) {
  debug("context: %O", context);
  return (
    context.compiler !== undefined && //(do NOT just put context.compiler here,
    //we need this to be a boolean, not undefined, because it gets put in the state)
    semver.satisfies(context.compiler.version, ">=0.5.1", {
      includePrerelease: true
    })
  );
}

function rangeNodes(node, pointer = "") {
  if (node instanceof Array) {
    return [].concat(
      ...node.map((sub, i) => rangeNodes(sub, `${pointer}/${i}`))
    );
  } else if (node instanceof Object) {
    let results = [];

    if (node.src !== undefined && node.id !== undefined) {
      //there are some "pseudo-nodes" with a src but no id.
      //these will cause problems, so we want to exclude them.
      //(to my knowledge this only happens with the externalReferences
      //to an InlineAssembly node, so excluding them just means we find
      //the InlineAssembly node instead, which is fine)
      results.push({ pointer, node, range: getRange(node) });
    }

    return results.concat(
      ...Object.keys(node).map(key =>
        rangeNodes(node[key], `${pointer}/${key}`)
      )
    );
  } else {
    return [];
  }
}

function findRange(findOverlappingRange, sourceStart, sourceLength) {
  // find nodes that fully contain requested range,
  // return one with longest pointer
  // (note: returns { range, node, pointer }
  let sourceEnd = sourceStart + sourceLength;
  return findOverlappingRange(sourceStart, sourceLength)
    .filter(({ range }) => sourceStart >= range[0] && sourceEnd <= range[1])
    .reduce(
      (acc, cur) => (cur.pointer.length >= acc.pointer.length ? cur : acc),
      { pointer: "" }
    );
  //note we make sure to bias towards cur (the new value being compared) rather than acc (the old value)
  //so that we don't actually get {pointer: ""} as our result
}

//function to create selectors that need both a current and next version
function createMultistepSelectors(stepSelector) {
  return {
    /**
     * .instruction
     */
    instruction: createLeaf(
      ["/current/instructionAtProgramCounter", stepSelector.programCounter],
      //HACK: we use solidity.current.instructionAtProgramCounter
      //even if we're looking at solidity.next.
      //This is harmless... so long as the current instruction isn't a context
      //change.  So, don't use solidity.next when it is.

      (map, pc) => map[pc] || {}
    ),

    /**
     * .modifierDepth
     */
    modifierDepth: createLeaf(
      ["./instruction"],
      instruction => instruction.modifierDepth
    ),

    /**
     * .source
     */
    source: createLeaf(
      //HACK: same hack as with instruction (we use current sources).
      //but I don't need to give the same warning twice.
      ["/current/sources", "./instruction"],

      (sources, { file: id }) => (sources ? sources[id] || {} : {})
    ),

    /**
     * HACK... you get the idea
     */
    findOverlappingRange: createLeaf(
      ["./source", "/views/findOverlappingRange"],
      ({ compilationId, id }, functions) => (functions[compilationId] || {})[id]
    ),

    /**
     * .sourceRange
     */
    sourceRange: createLeaf(["./instruction"], getSourceRange),

    /**
     * .pointerAndNode
     */
    pointerAndNode: createLeaf(
      ["./findOverlappingRange", "./sourceRange"],

      (findOverlappingRange, range) =>
        findOverlappingRange
          ? findRange(findOverlappingRange, range.start, range.length)
          : null
    ),

    /**
     * .pointer
     */
    pointer: createLeaf(
      ["./pointerAndNode"],

      pointerAndNode => (pointerAndNode ? pointerAndNode.pointer : null)
    ),

    /**
     * .node
     */
    node: createLeaf(
      ["./source", "./pointerAndNode"],

      ({ ast }, pointerAndNode) => (pointerAndNode ? pointerAndNode.node : ast)
    )
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
     * NOTE: grouped by compilation!
     */
    sources: createLeaf(["/state"], state => state.info.sources.byCompilationId)
  },

  /**
   * solidity.transaction
   */
  transaction: {
    /**
     * solidity.transaction.bottomStackframeRequiresPhantomFrame
     */
    bottomStackframeRequiresPhantomFrame: createLeaf(
      [evm.transaction.startingContext],
      contextRequiresPhantomStackframes
    )
  },

  /**
   * solidity.current
   */
  current: {
    /**
     * solidity.current.sources
     * This takes the place of the old solidity.info.sources,
     * returning only the sources for the current compilation.
     */
    sources: createLeaf(
      ["/info/sources", evm.current.context],
      (sources, context) =>
        context ? (sources[context.compilationId] || { byId: null }).byId : null
    ),

    /**
     * solidity.current.sourceMap
     */
    sourceMap: createLeaf(
      [evm.current.context],

      context => (context ? context.sourceMap : null) //null when no tx loaded
    ),

    /**
     * solidity.current.humanReadableSourceMap
     */
    humanReadableSourceMap: createLeaf(
      ["./sourceMap"],
      sourceMap =>
        sourceMap ? SolidityUtils.getHumanReadableSourceMap(sourceMap) : null
    ),

    /**
     * solidity.current.functionDepthStack
     */
    functionDepthStack: state => state.solidity.proc.functionDepthStack,

    /**
     * solidity.current.nextFrameIsPhantom
     */
    nextFrameIsPhantom: state => state.solidity.proc.nextFrameIsPhantom,

    /**
     * solidity.current.functionDepth
     */
    functionDepth: createLeaf(
      ["./functionDepthStack"],
      stack => stack[stack.length - 1]
    ),

    /**
     * solidity.current.callRequiresPhantomFrame
     */
    callRequiresPhantomFrame: createLeaf(
      [evm.current.context],
      contextRequiresPhantomStackframes
    ),

    /**
     * solidity.current.instructions
     */
    instructions: createLeaf(
      ["./sources", evm.current.context, "./humanReadableSourceMap"],

      (sources, context, sourceMap) => {
        if (!context || !sources) {
          return [];
        }
        let binary = context.binary;
        if (!binary) {
          return [];
        }

        let numInstructions;
        if (sourceMap) {
          numInstructions = sourceMap.length;
        } else {
          //HACK
          numInstructions = (binary.length - 2) / 2;
          //this is actually an overestimate, but that's OK
        }

        //because we might be dealing with a constructor with arguments, we do
        //*not* remove metadata manually
        let instructions = CodeUtils.parseCode(binary, numInstructions);

        if (!sourceMap) {
          // HACK
          // Let's create a source map to use since none exists. This source
          // map maps just as many ranges as there are instructions (or
          // possibly more), and marks them all as being Solidity-internal and
          // not jumps.
          sourceMap = new Array(instructions.length);
          sourceMap.fill({
            start: 0,
            length: 0,
            file: -1,
            jump: "-",
            modifierDepth: "0"
          });
        }

        var lineAndColumnMappings = Object.assign(
          {},
          ...Object.entries(sources).map(([id, { source }]) => ({
            [id]: SolidityUtils.getCharacterOffsetToLineAndColumnMapping(
              source || ""
            )
          }))
        );

        let primaryFile;
        if (sourceMap[0]) {
          primaryFile = sourceMap[0].file;
        }
        debug("primaryFile %o", primaryFile);

        return instructions
          .map((instruction, index) => {
            // lookup source map by index and add `index` property to
            // instruction
            //

            const instructionSourceMap = sourceMap[index] || {};

            return {
              instruction: { ...instruction, index },
              instructionSourceMap
            };
          })
          .map(({ instruction, instructionSourceMap }) => {
            // add source map information to instruction, or defaults

            const {
              jump,
              start = 0,
              length = 0,
              file = primaryFile,
              modifierDepth = 0
            } = instructionSourceMap;
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

            return {
              ...instruction,

              jump,
              start,
              length,
              file,
              range,
              modifierDepth
            };
          });
      }
    ),

    /**
     * solidity.current.instructionAtProgramCounter
     */
    instructionAtProgramCounter: createLeaf(
      ["./instructions"],

      instructions =>
        Object.assign(
          {},
          ...instructions.map(instruction => ({
            [instruction.pc]: instruction
          }))
        )
    ),

    ...createMultistepSelectors(evm.current.step),

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

    /*
     * solidity.current.functionsByProgramCounter
     */
    functionsByProgramCounter: createLeaf(
      [
        "./instructions",
        "./sources",
        "/views/findOverlappingRange",
        evm.current.context
      ],
      (instructions, sources, functions, { compilationId }) =>
        //note: we can skip an explicit null check on sources here because
        //if sources is null then instructions = [] so the problematic code
        //will never run
        Object.assign(
          {},
          ...instructions
            .filter(instruction => instruction.name === "JUMPDEST")
            .filter(instruction => instruction.file !== -1)
            //note that the designated invalid function *does* have an associated
            //file, so it *is* safe to just filter out the ones that don't
            .map(instruction => {
              debug("instruction %O", instruction);
              let sourceId = instruction.file;
              let findOverlappingRange = functions[compilationId][sourceId];
              let ast = sources[sourceId].ast;
              let range = getSourceRange(instruction);
              let { node, pointer } = findRange(
                findOverlappingRange,
                range.start,
                range.length
              );
              if (!pointer) {
                node = ast;
              }
              if (!node || node.nodeType !== "FunctionDefinition") {
                //filter out JUMPDESTs that aren't function definitions...
                //except for the designated invalid function
                let nextInstruction = instructions[instruction.index + 1] || {};
                if (nextInstruction.name === "INVALID") {
                  //designated invalid, include it
                  return {
                    [instruction.pc]: {
                      isDesignatedInvalid: true
                    }
                  };
                } else {
                  //not designated invalid, filter it out
                  return {};
                }
              }
              //otherwise, we're good to go, so let's find the contract node and
              //put it all together
              //to get the contract node, we go up twice from the function node;
              //the path from one to the other should have a very specific form,
              //so this is easy
              let contractPointer = pointer.replace(/\/nodes\/\d+$/, "");
              let contractNode = jsonpointer.get(ast, contractPointer);
              return {
                [instruction.pc]: {
                  sourceIndex: sourceId,
                  compilationId,
                  pointer,
                  node,
                  name: node.name,
                  id: node.id,
                  mutability: Codec.Ast.Utils.mutability(node),
                  contractPointer,
                  contractNode,
                  contractName: contractNode.name,
                  contractId: contractNode.id,
                  contractKind: contractNode.contractKind,
                  isDesignatedInvalid: false
                }
              };
            })
        )
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
     * solidity.current.willCallOrCreateButInstantlyReturn
     */
    willCallOrCreateButInstantlyReturn: createLeaf(
      [evm.current.step.isInstantCallOrCreate],
      x => x
    ),

    /**
     * solidity.current.willReturn
     */
    willReturn: createLeaf(
      [evm.current.step.isHalting],
      isHalting => isHalting
    ),

    /**
     * solidity.current.willFail
     */
    willFail: createLeaf([evm.current.step.isExceptionalHalting], x => x),

    /**
     * solidity.current.nextMapped
     * returns the next trace step after this one which is sourcemapped
     * HACK: this assumes we're not about to change context! don't use this if
     * we are!
     * ALSO, this may return undefined, so be prepared for that
     */
    nextMapped: createLeaf(
      ["./instructionAtProgramCounter", trace.steps, trace.index],
      (map, steps, index) =>
        steps.slice(index + 1).find(({ pc }) => map[pc] && map[pc].file !== -1)
    )
  },

  /**
   * solidity.next
   * HACK WARNING: do not use these selectors when the current instruction is a
   * context change! (evm call or evm return)
   */
  next: createMultistepSelectors(evm.next.step),

  /**
   * solidity.views
   */
  views: {
    /**
     * solidity.views.findOverlappingRange
     * grouped by compilation
     */
    findOverlappingRange: createLeaf(["/info/sources"], compilations =>
      Object.assign(
        {},
        ...Object.entries(compilations).map(
          ([compilationId, { byId: sources }]) => ({
            [compilationId]: sources.map(({ ast }) => {
              let tree = new IntervalTree();
              let ranges = rangeNodes(ast);
              for (let { range, node, pointer } of ranges) {
                let [start, end] = range;
                tree.insert(start, end, { range, node, pointer });
              }
              return (sourceStart, sourceLength) =>
                tree.search(sourceStart, sourceStart + sourceLength);
            })
          })
        )
      )
    )
  }
});

export default solidity;