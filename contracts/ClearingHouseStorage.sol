//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

import { Initializable } from '@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol';
import { IUniswapV3Pool } from '@uniswap/v3-core-0.8-support/contracts/interfaces/IUniswapV3Pool.sol';

import { Account } from './libraries/Account.sol';
import { Constants } from './utils/Constants.sol';
import { Governable } from './utils/Governable.sol';
import { LiquidationParams } from './libraries/Account.sol';
import { VTokenAddress, VTokenLib } from './libraries/VTokenLib.sol';
import { RealTokenLib } from './libraries/RealTokenLib.sol';

import { IOracle } from './interfaces/IOracle.sol';
import { IVPoolWrapper } from './interfaces/IVPoolWrapper.sol';

struct RageTradePool {
    IUniswapV3Pool vPool;
    IVPoolWrapper vPoolWrapper;
    RageTradePoolSettings settings;
}

struct RageTradePoolSettings {
    uint16 initialMarginRatio;
    uint16 maintainanceMarginRatio;
    uint32 twapDuration;
    bool whitelisted;
    IOracle oracle;
}

struct AccountStorage {
    mapping(uint32 => VTokenAddress) vTokenAddresses;
    mapping(uint32 => RealTokenLib.RealToken) realTokens;
    mapping(VTokenAddress => RageTradePool) rtPools;
    LiquidationParams liquidationParams;
    uint256 minRequiredMargin;
    uint256 removeLimitOrderFee;
    uint256 minimumOrderNotional;
    address VBASE_ADDRESS;
    address UNISWAP_V3_FACTORY_ADDRESS;
    uint24 UNISWAP_V3_DEFAULT_FEE_TIER;
    bytes32 UNISWAP_V3_POOL_BYTE_CODE_HASH;
}

abstract contract ClearingHouseStorage is Initializable, Governable {
    using VTokenLib for VTokenAddress;

    mapping(address => bool) public realTokenInitilized;
    mapping(VTokenAddress => bool) public supportedVTokens;
    mapping(VTokenAddress => bool) public supportedDeposits;

    uint256 public numAccounts;
    mapping(uint256 => Account.Info) accounts;

    bool public paused;

    AccountStorage public accountStorage;

    error Paused();
    error NotVPoolFactory();

    address public vPoolFactory;
    address public realBase;
    address public insuranceFundAddress;
}
