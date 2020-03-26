import debugModule from "debug";
const debug = debugModule("debugger:session:sagas");

import { call, all, fork, take, put, race } from "redux-saga/effects";

import { prefixName } from "../../helpers";

import * as ast from "../../ast/sagas";
import * as controller from "../../controller/sagas";
import * as solidity from "../../solidity/sagas";
import * as evm from "../../evm/sagas";
import * as trace from "../../trace/sagas";
import * as data from "../../data/sagas";
import * as ethers from "../../ethers/sagas";

import * as actions from "../actions";

const LOAD_SAGAS = {
  [actions.LOAD_TRANSACTION]: load
  //will also add reconstruct action/saga once it exists
};

function* listenerSaga() {
  while (true) {
    let action = yield take(Object.keys(LOAD_SAGAS));
    let saga = LOAD_SAGAS[action.type];

    yield put(actions.wait());
    yield race({
      exec: call(saga, action), //not all will use this
      interrupt: take(actions.INTERRUPT)
    });
    yield put(actions.ready());
  }
}

export function* saga() {
  debug("starting listeners");
  yield* forkListeners();

  // receiving & saving contracts into state
  debug("waiting for contract information");
  let { contexts, sources } = yield take(actions.RECORD_CONTRACTS);

  debug("recording contract binaries");
  yield* recordContexts(...contexts);

  debug("recording contract sources");
  yield* recordSources(sources);

  debug("normalizing contexts");
  yield* evm.normalizeContexts();

  debug("waiting for start");
  // wait for start signal
  let { txHash, provider } = yield take(actions.START);
  debug("starting");

  debug("visiting ASTs");
  // visit asts
  yield* ast.visitAll();

  //save allocation table
  debug("saving allocation table");
  yield* data.recordAllocations();

  //initialize ethers adapter
  yield* ethers.init(provider);

  //process transaction (if there is one)
  //(note: this part may also set the error state)
  if (txHash !== undefined) {
    yield* processTransaction(txHash);
  }

  debug("readying");
  // signal that commands can begin
  yield* ready();
}

export function* processTransaction(txHash) {
  // process transaction
  debug("fetching transaction info");
  let err = yield* fetchTx(txHash);
  if (err) {
    debug("error %o", err);
    yield* error(err);
  }
}

export default prefixName("session", saga);

function* forkListeners() {
  yield fork(listenerSaga); //session listener; this one is separate, sorry
  //(I didn't want to mess w/ the existing structure of defaults)
  return yield all(
    [controller, data, evm, solidity, trace, ethers].map(
      app => fork(app.saga)
      //ast no longer has a listener
    )
  );
}

function* fetchTx(txHash) {
  let result = yield* ethers.inspectTransaction(txHash);
  debug("result %o", result);

  if (result.error) {
    return result.error;
  }

  //get addresses created/called during transaction
  debug("processing trace for addresses");
  let addresses = yield* trace.processTrace(result.trace);
  //add in the address of the call itself (if a call)
  if (result.address && !addresses.includes(result.address)) {
    addresses.push(result.address);
  }
  //if a create, only add in address if it was successful
  if (
    result.binary &&
    result.status &&
    !addresses.includes(result.storageAddress)
  ) {
    addresses.push(result.storageAddress);
  }

  let blockNumber = result.block.number.toString(); //a BN is not accepted
  debug("obtaining binaries");
  let binaries = yield* ethers.obtainBinaries(addresses, blockNumber);

  debug("recording instances");
  yield all(
    addresses.map((address, i) => call(recordInstance, address, binaries[i]))
  );

  debug("sending initial call");
  yield* evm.begin(result);
  yield* solidity.begin(); //note: these must occur in this order
}

function* recordContexts(...contexts) {
  for (let context of contexts) {
    yield* evm.addContext(context);
  }
}

function* recordSources(sources) {
  yield* solidity.addSources(sources);
}

function* recordInstance(address, binary) {
  yield* evm.addInstance(address, binary);
}

function* ready() {
  yield put(actions.ready());
}

function* error(err) {
  yield put(actions.error(err));
}

export function* unload() {
  debug("unloading");
  yield* data.reset();
  yield* solidity.unload();
  yield* evm.unload();
  yield* trace.unload();
  yield put(actions.unloadTransaction());
}

//note that load takes an action as its argument, which is why it's separate
//from processTransaction
function* load({ txHash }) {
  yield* processTransaction(txHash);
}