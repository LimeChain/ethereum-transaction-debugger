export const INIT_ETHERS_JS = "INIT_ETHERS_JS";
export function init(provider) {
  return {
    type: INIT_ETHERS_JS,
    provider
  };
}

export const INSPECT = "INSPECT_TRANSACTION";
export function inspect(txHash) {
  return {
    type: INSPECT,
    txHash
  };
}

export const FETCH_BINARY = "FETCH_BINARY";
export function fetchBinary(address) {
  return {
    type: FETCH_BINARY,
    address
  };
}

export const RECEIVE_BINARY = "RECEIVE_BINARY";
export function receiveBinary(address, binary) {
  return {
    type: RECEIVE_BINARY,
    address,
    binary
  };
}

export const RECEIVE_TRACE = "RECEIVE_TRACE";
export function receiveTrace(trace) {
  return {
    type: RECEIVE_TRACE,
    trace
  };
}

export const RECEIVE_CALL = "RECEIVE_CALL";
export function receiveCall({ address, binary }) {
  return {
    type: RECEIVE_CALL,
    address,
    binary
  };
}

export const ERROR_ETHERS_JS = "ERROR_ETHERS_JS";
export function error(error) {
  return {
    type: ERROR_ETHERS_JS,
    error
  };
}
