import debugModule from "debug";
const debug = debugModule("debugger:trace:sagas");

import { take, takeEvery, put, select } from "redux-saga/effects";
import { prefixName, isCallMnemonic } from "../../helpers";

import * as actions from "../actions";

import trace from "../selectors";

function* waitForTrace() {
  let { steps } = yield take(actions.SAVE_STEPS);

  let addresses = [
    ...new Set(
      steps
        .filter(({ op }) => isCallMnemonic(op))
        .map(({ stack }) => "0x" + stack[stack.length - 2].substring(24))
    )
  ];
  yield put(actions.receiveAddresses(addresses));
}

export function* advance() {
  yield put(actions.next());

  debug("TOCK to take");
  yield take([actions.TOCK, actions.END_OF_TRACE]);
  debug("TOCK taken");
}

function* next() {
  let remaining = yield select(trace.stepsRemaining);
  debug("remaining: %o", remaining);
  let steps = yield select(trace.steps);
  debug("total steps: %o", steps.length);

  if (remaining > 0) {
    debug("putting TICK");
    // updates state for current step
    yield put(actions.tick());
    debug("put TICK");

    remaining--; // local update, just for convenience
  }

  if (remaining) {
    debug("putting TOCK");
    // updates step to next step in trace
    yield put(actions.tock());
    debug("put TOCK");
  } else {
    debug("putting END_OF_TRACE");
    yield put(actions.endTrace());
    debug("put END_OF_TRACE");
  }
}

export function* processTrace(trace) {
  yield put(actions.saveSteps(trace));

  let { addresses } = yield take(actions.RECEIVE_ADDRESSES);
  debug("received addresses");

  return addresses;
}

export function* reset() {
  yield put(actions.reset());
}

export function* saga() {
  // wait for trace to be defined
  yield* waitForTrace();

  yield takeEvery(actions.NEXT, next);
}

export default prefixName("trace", saga);
