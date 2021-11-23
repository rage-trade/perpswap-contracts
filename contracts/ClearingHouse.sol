//SPDX-License-Identifier: UNLICENSED

pragma solidity ^0.8.9;

import { Account, LiquidityChangeParams, LiquidationParams } from './libraries/Account.sol';
import { LimitOrderType } from './libraries/LiquidityPosition.sol';
import { ClearingHouseState } from './ClearingHouseState.sol';

contract ClearingHouse is ClearingHouseState {
    LiquidationParams public liquidationParams;
    using Account for Account.Info;
    uint256 public numAccounts;
    mapping(uint256 => Account.Info) accounts;

    address public immutable realBase;
    event AccountCreated(address ownerAddress, uint256 accountNo);
    event DepositMargin(uint256 accountNo, uint32 truncatedTokenAddress, uint256 amount);
    event WithdrawMargin(uint256 accountNo, uint32 truncatedTokenAddress, uint256 amount);
    event WithdrawProfit(uint256 accountNo, int256 amount);

    event Swap(uint256 accountNo, uint32 truncatedTokenAddress, int256 tokenAmountOut, int256 baseAmountOut);
    event LiqudityChange(
        uint256 accountNo,
        int24 tickLower,
        int24 tickUpper,
        int128 liquidityDelta,
        LimitOrderType limitOrderType,
        int256 tokenAmountOut,
        int256 baseAmountOut
    );
    event LiquidateRanges(uint256 accountNo, uint256 liquidationFee);
    event LiquidateTokenPosition(uint256 accountNo, uint256 notionalClosed, uint256 liquidationFee);

    event FundingPayment(uint256 accountNo, uint256 identifier, int256 amount);
    event Fee(uint256 accountNo, uint256 identifier, int256 amount);

    constructor(
        address VBASE_ADDRESS,
        address UNISWAP_FACTORY_ADDRESS,
        uint24 DEFAULT_FEE_TIER,
        bytes32 POOL_BYTE_CODE_HASH
    ) VPoolFactory(VBASE_ADDRESS, UNISWAP_FACTORY_ADDRESS, DEFAULT_FEE_TIER, POOL_BYTE_CODE_HASH) {}

    constructor(address VPoolFactory, address _realBase) ClearingHouseState(VPoolFactory) {
        realBase = _realBase;
    }

    function createAccount() external {
        Account.Info storage newAccount = accounts[numAccounts];
        newAccount.owner = msg.sender;

        emit AccountCreated(msg.sender, numAccounts++);
    }

    function addMargin(
        uint256 accountNo,
        uint32 vTokenTruncatedAddress,
        uint256 amount
    ) external {
        Account.Info storage account = accounts[accountNo];
        require(msg.sender == account.owner, 'Access Denied');

        address vTokenAddress = vTokenAddresses[vTokenTruncatedAddress];
        require(supportedDeposits[vTokenAddress], 'Unsupported Token');

        account.addMargin(vTokenAddress, amount, constants);

        emit DepositMargin(accountNo, vTokenTruncatedAddress, amount);
    }

    function removeMargin(
        uint256 accountNo,
        uint32 vTokenTruncatedAddress,
        uint256 amount
    ) external {
        Account.Info storage account = accounts[accountNo];
        require(msg.sender == account.owner, 'Access Denied');

        address vTokenAddress = vTokenAddresses[vTokenTruncatedAddress];
        require(supportedDeposits[vTokenAddress], 'Unsupported Token');

        account.removeMargin(vTokenAddress, amount, vTokenAddresses, constants);

        emit WithdrawMargin(accountNo, vTokenTruncatedAddress, amount);
    }

    function swapTokenAmount(
        uint256 accountNo,
        uint32 vTokenTruncatedAddress,
        int256 vTokenAmount
    ) external {
        Account.Info storage account = accounts[accountNo];
        require(msg.sender == account.owner, 'Access Denied');

        address vTokenAddress = vTokenAddresses[vTokenTruncatedAddress];
        require(supportedVTokens[vTokenAddress], 'Unsupported Token');

        (int256 vTokenAmountOut, int256 vBaseAmountOut) = account.swapTokenAmount(
            vTokenAddress,
            vTokenAmount,
            vTokenAddresses,
            constants
        );

        //TODO: add base amount as return value and replace 0 with that
        emit Swap(accountNo, vTokenTruncatedAddress, vTokenAmountOut, vBaseAmountOut);
    }

    function swapTokenNotional(
        uint256 accountNo,
        uint32 vTokenTruncatedAddress,
        int256 vBaseAmount
    ) external {
        Account.Info storage account = accounts[accountNo];
        require(msg.sender == account.owner, 'Access Denied');

        address vTokenAddress = vTokenAddresses[vTokenTruncatedAddress];
        require(supportedVTokens[vTokenAddress], 'Unsupported Token');

        (int256 vTokenAmountOut, int256 vBaseAmountOut) = account.swapTokenNotional(
            vTokenAddress,
            vBaseAmount,
            vTokenAddresses,
            constants
        );

        //TODO: add base amount as return value and replace 0 with that
        emit Swap(accountNo, vTokenTruncatedAddress, vTokenAmountOut, vBaseAmountOut);
    }

    function updateRangeOrder(
        uint256 accountNo,
        uint32 vTokenTruncatedAddress,
        LiquidityChangeParams calldata liquidityChangeParams
    ) external {
        Account.Info storage account = accounts[accountNo];
        require(msg.sender == account.owner, 'Access Denied');

        address vTokenAddress = vTokenAddresses[vTokenTruncatedAddress];
        require(supportedVTokens[vTokenAddress], 'Unsupported Token');

        account.liquidityChange(vTokenAddress, liquidityChangeParams, vTokenAddresses, constants);

        emit LiqudityChange(
            accountNo,
            liquidityChangeParams.tickLower,
            liquidityChangeParams.tickUpper,
            liquidityChangeParams.liquidityDelta,
            liquidityChangeParams.limitOrderType,
            0,
            0
        );
    }

    function removeLimitOrder(
        uint256 accountNo,
        uint32 vTokenTruncatedAddress,
        int24 tickLower,
        int24 tickUpper
    ) external {
        Account.Info storage account = accounts[accountNo];

        address vTokenAddress = vTokenAddresses[vTokenTruncatedAddress];
        require(supportedVTokens[vTokenAddress], 'Unsupported Token');

        //TODO: Add remove limit order fee immutable and replace 0 with that
        account.removeLimitOrder(vTokenAddress, tickLower, tickUpper, 0, vTokenAddresses, constants);

        // emit LiqudityChange(accountNo, tickLower, tickUpper, liquidityDelta, 0, 0, 0);
    }

    function liquidateLiquidityPositions(uint256 accountNo) external {
        Account.Info storage account = accounts[accountNo];

        (int256 keeperFee, int256 insuranceFundFee) = account.liquidateLiquidityPositions(
            liquidationParams.liquidationFeeFraction,
            vTokenAddresses,
            constants
        );
        int256 accountFee = keeperFee + insuranceFundFee;

        emit LiquidateRanges(accountNo, uint256(accountFee));
    }

    function liquidateTokenPosition(uint256 accountNo, uint32 vTokenTruncatedAddress) external {
        Account.Info storage account = accounts[accountNo];

        address vTokenAddress = vTokenAddresses[vTokenTruncatedAddress];
        require(supportedVTokens[vTokenAddress], 'Unsupported Token');

        account.liquidateTokenPosition(vTokenAddress, liquidationParams, vTokenAddresses, constants);
    }
}
