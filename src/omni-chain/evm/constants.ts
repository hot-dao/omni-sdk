export const OMNI_CONTRACT = "0x42351e68420D16613BBE5A7d8cB337A9969980b4";
export const OMNI_DEPOSIT_FT = "function deposit(bytes memory receiver, address contract_id, uint128 amount)";
export const OMNI_DEPOSIT_NATIVE = "function deposit(bytes memory receiver) payable";
export const OMNI_DEPOSIT_LOG = {
  anonymous: false,
  inputs: [
    { indexed: false, internalType: "uint128", name: "nonce", type: "uint128" },
    { indexed: false, internalType: "uint128", name: "amount", type: "uint128" },
    { indexed: false, internalType: "bytes", name: "contract_id", type: "bytes" },
    { indexed: false, internalType: "bytes", name: "receiver", type: "bytes" },
  ],
  name: "NewTransfer",
  type: "event",
};

export const OMNI_ABI = [
  OMNI_DEPOSIT_LOG,
  "function withdraw(uint128 nonce, address contract_id, address receiver_id, uint128 amount, bytes memory signature)",
  {
    inputs: [{ internalType: "uint128", name: "", type: "uint128" }],
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
    name: "usedNonces",
  },
];

export const ERC20_ABI = [
  "function name() public view returns (string)",
  "function symbol() public view returns (string)",
  "function decimals() public view returns (uint8)",
  "function totalSupply() public view returns (uint256)",
  "function balanceOf(address _owner) public view returns (uint256 balance)",
  "function transfer(address _to, uint256 _value) public returns (bool success)",
  "function transferFrom(address _from, address _to, uint256 _value) public returns (bool success)",
  "function approve(address _spender, uint256 _value) public returns (bool success)",
  "function allowance(address _owner, address _spender) public view returns (uint256 remaining)",
];
