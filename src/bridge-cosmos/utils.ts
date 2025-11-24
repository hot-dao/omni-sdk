export async function smartQuery(rpcUrl: string, contractAddress: string, msg: Record<string, any>) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const queryBytes = encoder.encode(JSON.stringify(msg));

  function encodeVarint(num: number) {
    const bytes = [];
    let n = num >>> 0;
    while (n >= 0x80) {
      bytes.push((n & 0x7f) | 0x80);
      n >>>= 7;
    }
    bytes.push(n);
    return Uint8Array.from(bytes);
  }

  // --- protobuf QuerySmartContractStateRequest ---
  // message QuerySmartContractStateRequest {
  //   string address = 1;  // tag = 1 (0x0a)
  //   bytes  query_data = 2; // tag = 2 (0x12)
  // }
  function encodeQuerySmartContractStateRequest(address: string, queryBytes: Uint8Array) {
    const addrBytes = encoder.encode(address);
    const chunks = [];

    // field 1: address (tag 1, wire type 2 => 0x0a)
    chunks.push(0x0a);
    chunks.push(...encodeVarint(addrBytes.length));
    chunks.push(...addrBytes);

    // field 2: query_data (tag 2, wire type 2 => 0x12)
    chunks.push(0x12);
    chunks.push(...encodeVarint(queryBytes.length));
    chunks.push(...queryBytes);

    return Uint8Array.from(chunks);
  }

  const protoBytes = encodeQuerySmartContractStateRequest(contractAddress, queryBytes);
  const dataB64 = Buffer.from(protoBytes).toString("base64");
  const body = {
    params: { path: "/cosmwasm.wasm.v1.Query/SmartContractState", data: dataB64, prove: false },
    method: "abci_query",
    jsonrpc: "2.0",
    id: 1,
  };

  const res = await fetch(rpcUrl, {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    method: "POST",
  });

  const json = await res.json();
  if (json.error) throw new Error(`RPC error ${json.error.code}: ${json.error.message || "unknown"}`);

  const valueB64 = json.result?.response?.value;
  if (!valueB64) return null;

  const valueBytes = typeof Buffer !== "undefined" ? Buffer.from(valueB64, "base64") : Uint8Array.from(atob(valueB64), (c) => c.charCodeAt(0));
  const text = decoder.decode(valueBytes);

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
