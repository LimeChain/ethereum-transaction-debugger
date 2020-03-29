import debugModule from "debug";
const debug = debugModule("debugger:ethersJS:sagas");
const ethers = require('ethers');

import {
  all,
  takeEvery,
  apply,
  fork,
  join,
  take,
  put
} from 'redux-saga/effects';
import {
  prefixName
} from "../../helpers";
import BN from "bn.js";

import * as actions from "../actions";
import * as session from "../../session/actions";

import EthersJSAdapter from "../adapter";

function* fetchTransactionInfo(adapter, {
  txHash
}) {
  debug("inspecting transaction");
  var trace;
  try {
    trace = yield apply(adapter, adapter.getEthersTrace, [txHash]);
  } catch (e) {
    debug("putting error");
    yield put(actions.error(e));
    return;
  }

  debug("got trace");
  yield put(actions.receiveTrace(trace));

  let tx = yield apply(adapter, adapter.getEthersTransaction, [txHash]);
  debug("tx %O", tx);


  let receipt = yield apply(adapter, adapter.getEthersReceipt, [txHash]);
  debug("receipt %O", receipt);

  let block = yield apply(adapter, adapter.getBlock, [tx.blockNumber]);
  debug("block %O", block);

  yield put(session.saveTransaction(tx));
  yield put(session.saveReceipt(receipt));
  yield put(session.saveBlock(block));

  let solidityBlock = {
    coinbase: block.miner,
    difficulty: new BN(block.difficulty),
    gaslimit: new BN(block.gasLimit.toString()),
    number: new BN(block.number),
    timestamp: new BN(block.timestamp)
  };
  if (tx.to != null) {
    let test = {
      address: tx.to,
      data: tx.data,
      storageAddress: tx.to,
      status: receipt.status,
      sender: tx.from,
      value: new BN(tx.value.toString()),
      gasprice: new BN(tx.gasPrice.toString()),
      block: solidityBlock
    };
    yield put(actions.receiveCall({
      address: tx.to,
      data: tx.data,
      storageAddress: tx.to,
      status: receipt.status,
      sender: tx.from,
      value: new BN(tx.value.toString()),
      gasprice: new BN(tx.gasPrice.toString()),
      block: solidityBlock
    }));
  } else {
    let storageAddress = isAddress(receipt.contractAddress) ?
      receipt.contractAddress :
      Codec.Evm.Utils.ZERO_ADDRESS;

    yield put(actions.receiveCall({
      binary: tx.input || tx.data,
      storageAddress,
      status: receipt.status,
      sender: tx.from,
      value: tx.value,
      gasprice: tx.gasPrice,
      block: solidityBlock
    }));
  }
}

function* fetchBinary(adapter, {
  address,
  block
}) {
  debug("fetching binary for %s", address);
  let binary = yield apply(adapter, adapter.getEthersDeployedCode, [address, block]);

  debug("received binary for %s", address);
  yield put(actions.receiveBinary(address, binary));
}

export function* inspectTransaction(txHash) {
  yield put(actions.inspect(txHash));

  // let action = yield take(({ type }) =>
  //   type == actions.RECEIVE_TRACE || type == actions.ERROR_ETHERS_JS
  // );
  // debug("action %o", action);

  let action = yield take([actions.RECEIVE_TRACE, actions.ERROR_ETHERS_JS]);
  debug("action %o", action);

  var trace;
  if (action.type == actions.RECEIVE_TRACE) {
    trace = action.trace;
    debug("received trace");
  } else {
    return {
      error: action.error
    };
  }

  let {
    address,
    binary,
    data,
    storageAddress,
    status,
    sender,
    value,
    gasprice,
    block
  } = yield take(actions.RECEIVE_CALL);
  debug("received call");

  return {
    trace,
    address,
    binary,
    data,
    storageAddress,
    status,
    sender,
    value,
    gasprice,
    block
  };
}

export function* obtainBinaries(addresses, block) {
  let tasks = yield all(
    addresses.map((address) => fork(receiveBinary, address))
  );

  debug("requesting binaries");
  yield all(
    addresses.map((address) => put(actions.fetchBinary(address, block)))
  );

  let binaries = [];
  binaries = yield all(
    tasks.map(task => join(task))
  );

  debug("binaries %o", binaries);

  return binaries;
}

function* receiveBinary(address) {
  let {
    binary
  } = yield take((action) => (
    action.type == actions.RECEIVE_BINARY &&
    action.address == address
  ));
  debug("got binary for %s", address);

  return binary;
}

function* isAddress(address) {
  try {
    ethers.utils.getAddress(address);
  } catch (e) {
    return false;
  }
  return true;
}

export function* init(provider) {
  yield put(actions.init(provider));
}

export function* saga() {
  // wait for ethersjs init signal
  let {
    provider
  } = yield take(actions.INIT_ETHERS_JS);
  let adapter = new EthersJSAdapter(provider);

  yield takeEvery(actions.INSPECT, fetchTransactionInfo, adapter);
  yield takeEvery(actions.FETCH_BINARY, fetchBinary, adapter);
}

export default prefixName("ethersJS", saga);