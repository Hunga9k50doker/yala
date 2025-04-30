const { ethers } = require("ethers");
const settings = require("../config/config");

const provider = new ethers.JsonRpcProvider(settings.RPC_URL);

const YBTC_ADDRESS = "0xBBd3EDd4D3b519c0d14965d9311185CFaC8c3220";
const YU_ADDRESS = "0xe0232D625Ea3B94698F0a7DfF702931B704083c9";
const WETH_ADDRESS = "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14";
const EXPOLER = "https://sepolia.etherscan.io/tx/";

const availableTokens = {
  ETH: { name: "ETH", address: null, decimals: 18, native: true },
  WETH: { name: "WETH", address: WETH_ADDRESS, decimals: 18, native: false },
  YBTC: { name: "YBTC", address: YBTC_ADDRESS, decimals: 18, native: false },
  YU: { name: "YU", address: YU_ADDRESS, decimals: 18, native: false },
};

const ROUTER_ABI = [
  "function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)",
  "function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)",
  "function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
  "function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
];

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function approve(address spender, uint256 value) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function transfer(address to, uint amount) returns (bool)",
];

async function swapSETH_YBTC(privateKey, amount) {
  try {
    const amountIn = ethers.parseUnits(`${amount}`, 18);
    const wallet = new ethers.Wallet(privateKey, provider);
    const contract = new ethers.Contract(
      "0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b",
      [
        {
          name: "swapExactTokensForETH",
          type: "function",
          stateMutability: "nonpayable",
          inputs: [
            { internalType: "uint256", name: "amountIn", type: "uint256" },
            { internalType: "uint256", name: "amountOutMin", type: "uint256" },
            { internalType: "address[]", name: "path", type: "address[]" },
            { internalType: "address", name: "to", type: "address" },
            { internalType: "uint256", name: "deadline", type: "uint256" },
          ],
        },
      ],
      wallet
    );
    const commands = "0x3593564c";
    const inputs = ``;
    const deadline = Math.floor(Date.now() / 1000) + 3600;

    const tx = await contract.execute(commands, [inputs], deadline, {
      gasLimit: 210000,
      value: amountIn,
    });
    await tx.wait();

    return {
      tx: tx.hash,
      success: true,
      message: `Swap successful! Transaction hash: ${tx.hash}`,
    };
  } catch (error) {
    console.error("Error:", error.message);
    return {
      tx: null,
      success: false,
      message: `Error: ${error.message}`,
    };
  }
}

const SWAP_ROUTER_ADDRESS = "0xBBd3EDd4D3b519c0d14965d9311185CFaC8c3220";

async function approveToken(wallet, amount) {
  try {
    const ybtcContract = new ethers.Contract(YBTC_ADDRESS, ERC20_ABI, wallet);
    const allowance = await ybtcContract.allowance(wallet.address, SWAP_ROUTER_ADDRESS);
    if (allowance < amount) {
      const approveTx = await ybtcContract.approve(SWAP_ROUTER_ADDRESS, ethers.MaxUint256, {
        gasLimit: 54000,
      });
      await approveTx.wait();
      console.log("Approve completed!", approveTx.hash);
    } else {
      console.log("Already approved!");
    }
    return true;
  } catch (error) {
    console.error("Approve failed:", error);
    return false;
  }
}

async function swapYBTC_YU(privateKey, amount) {
  const path = [
    "0xBBd3EDd4D3b519c0d14965d9311185CFaC8c322", // YBTC
    "0xe0232D625Ea3B94698F0a7DfF702931B704083c9", // YU
  ];
  try {
    const amountIn = ethers.parseUnits(`${amount}`, 18);
    const wallet = new ethers.Wallet(privateKey, provider);
    const contract = new ethers.Contract("0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b", ROUTER_ABI, wallet);
    const commands = "0x7ec940a8";

    const deadline = Math.floor(Date.now() / 1000) + 3600; // Thời gian hết hạn
    await approveToken(wallet, amountIn);

    const tx = await contract.swapExactTokensForTokens(amountIn, 0, path, wallet.address, deadline, {
      gasLimit: 600000,
    });
    await tx.wait();

    return {
      tx: tx.hash,
      success: true,
      message: `Mint YU successful! Transaction hash: ${tx.hash}`,
    };
  } catch (error) {
    console.error("Error:", error.message);
    return {
      tx: null,
      success: false,
      message: `Error: ${error.message}`,
    };
  }
}

async function checkBalance(privateKey, tokenAddress) {
  const wallet = new ethers.Wallet(privateKey, provider);
  try {
    if (tokenAddress) {
      const tokenContract = new ethers.Contract(tokenAddress, ["function balanceOf(address owner) view returns (uint256)"], wallet);
      const balance = await tokenContract.balanceOf(wallet.address);
      const decimals = 18;
      return parseFloat(ethers.formatUnits(balance, decimals)).toFixed(4);
    } else {
      // Check balance for native Sepolia ETH
      const balance = await wallet.getBalance();
      return parseFloat(ethers.formatEther(balance)).toFixed(4);
    }
  } catch (error) {
    console.log(`[${wallet.address}] Failed to check balance: ${error.message}`.red);
    return "0";
  }
}

async function stakeYU(privateKey, amount) {
  try {
    const amountIn = ethers.parseUnits(`${amount}`, 18);
    const wallet = new ethers.Wallet(privateKey, provider);
    const contract = new ethers.Contract("0xd8A62e777714535c9A3006872661263a825F8803", ["function provideToSP(uint256 _amount)"], wallet);

    const tx = await contract.provideToSP(amountIn, {
      gasLimit: 300000,
    });
    await tx.wait();

    return {
      tx: tx.hash,
      success: true,
      message: `Stake ${amount} YU successful! Transaction hash: ${EXPOLER}${tx.hash}`,
    };
  } catch (error) {
    return {
      tx: null,
      success: false,
      message: `Error Stake YU: ${error.message}`,
    };
  }
}

module.exports = { swapSETH_YBTC, stakeYU, swapYBTC_YU, checkBalance };
