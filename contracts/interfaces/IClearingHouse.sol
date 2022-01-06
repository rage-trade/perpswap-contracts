//SPDX-License-Identifier: UNLICENSED

pragma solidity ^0.8.9;

import { LimitOrderType } from '../libraries/LiquidityPosition.sol';
import { LiquidityChangeParams, SwapParams } from '../libraries/Account.sol';
import { VTokenAddress } from '../libraries/VTokenLib.sol';
import { Account } from '../libraries/Account.sol';

import { Constants } from '../utils/Constants.sol';

interface IClearingHouse {
    /// @notice error to denote invalid account access
    /// @param senderAddress address of msg sender
    error AccessDenied(address senderAddress);

    /// @notice error to denote usage of unsupported token
    /// @param vTokenAddress address of token
    error UnsupportedToken(VTokenAddress vTokenAddress);

    /// @notice error to denote low notional value of txn
    /// @param notionalValue notional value of txn
    error LowNotionalValue(uint256 notionalValue);

    /// @notice error to denote invalid token liquidation (fraction to liquidate> 1)
    error InvalidTokenLiquidationParameters();

    /// @notice error to denote usage of unitialized token
    /// @param vTokenTruncatedAddress unitialized truncated address supplied
    error UninitializedToken(uint32 vTokenTruncatedAddress);

    /// @notice error to denote slippage of txn beyond set threshold
    error SlippageBeyondTolerance();

    /// @notice creates a new account and adds it to the accounts map
    /// @return newAccountId - serial number of the new account created
    function createAccount() external returns (uint256 newAccountId);

    /// @notice withdraws protocol fees collected in the supplied wrappers to team multisig
    /// @param wrapperAddresses list of wrapper addresses to collect fees from
    function withdrawProtocolFee(address[] calldata wrapperAddresses) external;

    /// @notice deposits 'amount' of token associated with 'vTokenTruncatedAddress'
    /// @param accountNo account number
    /// @param vTokenTruncatedAddress truncated address of token to deposit
    /// @param amount amount of token to deposit
    function addMargin(
        uint256 accountNo,
        uint32 vTokenTruncatedAddress,
        uint256 amount
    ) external;

    /// @notice withdraws 'amount' of token associated with 'vTokenTruncatedAddress'
    /// @param accountNo account number
    /// @param vTokenTruncatedAddress truncated address of token to withdraw
    /// @param amount amount of token to withdraw
    function removeMargin(
        uint256 accountNo,
        uint32 vTokenTruncatedAddress,
        uint256 amount
    ) external;

    /// @notice withdraws 'amount' of base token from the profit made
    /// @param accountNo account number
    /// @param amount amount of token to withdraw
    function removeProfit(uint256 accountNo, uint256 amount) external;

    /// @notice swaps token associated with 'vTokenTruncatedAddress' by 'amount' (Long if amount>0 else Short)
    /// @param accountNo account number
    /// @param vTokenTruncatedAddress truncated address of token to withdraw
    /// @param swapParams swap parameters
    function swapToken(
        uint256 accountNo,
        uint32 vTokenTruncatedAddress,
        SwapParams memory swapParams
    ) external returns (int256 vTokenAmountOut, int256 vBaseAmountOut);

    /// @notice updates range order of token associated with 'vTokenTruncatedAddress' by 'liquidityDelta' (Adds if amount>0 else Removes)
    /// @notice also can be used to update limitOrderType
    /// @param accountNo account number
    /// @param vTokenTruncatedAddress truncated address of token to withdraw
    /// @param liquidityChangeParams liquidity change parameters
    function updateRangeOrder(
        uint256 accountNo,
        uint32 vTokenTruncatedAddress,
        LiquidityChangeParams calldata liquidityChangeParams
    ) external returns (int256 vTokenAmountOut, int256 vBaseAmountOut);

    /// @notice keeper call to remove a limit order
    /// @dev checks the position of current price relative to limit order and checks limitOrderType
    /// @param accountNo account number
    /// @param vTokenTruncatedAddress truncated address of token to withdraw
    /// @param tickLower liquidity change parameters
    /// @param tickUpper liquidity change parameters
    function removeLimitOrder(
        uint256 accountNo,
        uint32 vTokenTruncatedAddress,
        int24 tickLower,
        int24 tickUpper
    ) external returns (uint256 keeperFee);

    /// @notice keeper call for liquidation of range position
    /// @dev removes all the active range positions and gives liquidator a percent of notional amount closed + fixedFee
    /// @param accountNo account number
    function liquidateLiquidityPositions(uint256 accountNo) external returns (int256 keeperFee);

    /// @notice keeper call for liquidation of token position
    /// @dev transfers the fraction of token position at a discount to current price to liquidators account and gives liquidator some fixedFee
    /// @param liquidatorAccountNo liquidator account number
    /// @param accountNo account number
    /// @param vTokenTruncatedAddress truncated address of token to withdraw
    /// @param liquidationBps fraction of the token position to be transferred in BPS
    /// @return liquidatorBalanceAdjustments - balance changes in liquidator base and token balance and net token position
    function liquidateTokenPosition(
        uint256 liquidatorAccountNo,
        uint256 accountNo,
        uint32 vTokenTruncatedAddress,
        uint16 liquidationBps
    ) external returns (Account.BalanceAdjustments memory liquidatorBalanceAdjustments);

    function isVTokenAddressAvailable(uint32 truncated) external view returns (bool);

    function addVTokenAddress(uint32 truncated, address full) external;

    function isRealTokenAlreadyInitilized(address _realToken) external view returns (bool);

    function initRealToken(address _realToken) external;

    function setConstants(Constants memory constants) external;
}
