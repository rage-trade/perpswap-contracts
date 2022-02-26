//SPDX-License-Identifier: UNLICENSED

pragma solidity ^0.8.9;

import { IERC20 } from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import { SafeERC20 } from '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import { SafeCast } from '@uniswap/v3-core-0.8-support/contracts/libraries/SafeCast.sol';

import { Account } from '../../libraries/Account.sol';
import { AddressHelper } from '../../libraries/AddressHelper.sol';
import { LiquidityPositionSet } from '../../libraries/LiquidityPositionSet.sol';
import { VTokenPositionSet } from '../../libraries/VTokenPositionSet.sol';
import { SignedMath } from '../../libraries/SignedMath.sol';
import { VTokenLib } from '../../libraries/VTokenLib.sol';
import { Calldata } from '../../libraries/Calldata.sol';

import { IClearingHouse } from '../../interfaces/IClearingHouse.sol';
import { IInsuranceFund } from '../../interfaces/IInsuranceFund.sol';
import { IVPoolWrapper } from '../../interfaces/IVPoolWrapper.sol';
import { IOracle } from '../../interfaces/IOracle.sol';
import { IVBase } from '../../interfaces/IVBase.sol';
import { IVToken } from '../../interfaces/IVToken.sol';

import { IClearingHouseActions } from '../../interfaces/clearinghouse/IClearingHouseActions.sol';
import { IClearingHouseStructures } from '../../interfaces/clearinghouse/IClearingHouseStructures.sol';
import { IClearingHouseEnums } from '../../interfaces/clearinghouse/IClearingHouseEnums.sol';
import { IClearingHouseOwnerActions } from '../../interfaces/clearinghouse/IClearingHouseOwnerActions.sol';
import { IClearingHouseSystemActions } from '../../interfaces/clearinghouse/IClearingHouseSystemActions.sol';

import { Multicall } from '../../utils/Multicall.sol';
import { OptimisticGasUsedClaim } from '../../utils/OptimisticGasUsedClaim.sol';

import { ClearingHouseView } from './ClearingHouseView.sol';

import { console } from 'hardhat/console.sol';

contract ClearingHouse is IClearingHouse, ClearingHouseView, Multicall, OptimisticGasUsedClaim {
    using SafeERC20 for IERC20;
    using Account for Account.UserInfo;
    using AddressHelper for IERC20;
    using VTokenLib for IVToken;
    using SignedMath for int256;
    using SafeCast for uint256;
    using SafeCast for int256;

    error Paused();
    error NotRageTradeFactory();

    modifier onlyRageTradeFactory() {
        if (rageTradeFactoryAddress != msg.sender) revert NotRageTradeFactory();
        _;
    }

    modifier notPaused() {
        if (paused) revert Paused();
        _;
    }

    /**
        SYSTEM FUNCTIONS
     */

    function __initialize_ClearingHouse(
        address _rageTradeFactoryAddress,
        IERC20 _defaultCollateralToken,
        IOracle _defaultCollateralTokenOracle,
        IInsuranceFund _insuranceFund,
        IVBase _vBase,
        IOracle _nativeOracle
    ) external initializer {
        rageTradeFactoryAddress = _rageTradeFactoryAddress;
        protocol.rBase = _defaultCollateralToken;
        insuranceFund = _insuranceFund;
        nativeOracle = _nativeOracle;

        protocol.vBase = _vBase;

        _updateCollateralSettings(
            _defaultCollateralToken,
            CollateralSettings({ oracle: _defaultCollateralTokenOracle, twapDuration: 60, supported: true })
        );

        __Governable_init();
    }

    function registerPool(address full, Pool calldata rageTradePool) external onlyRageTradeFactory {
        IVToken vToken = IVToken(full);
        uint32 truncated = vToken.truncate();

        // pool will not be registered twice by the rage trade factory
        assert(protocol.vTokens[truncated].eq(address(0)));

        protocol.vTokens[truncated] = vToken;
        protocol.pools[vToken] = rageTradePool;
    }

    /**
        ADMIN FUNCTIONS
     */

    function updateCollateralSettings(IERC20 cToken, CollateralSettings memory collateralSettings)
        external
        onlyGovernanceOrTeamMultisig
    {
        _updateCollateralSettings(cToken, collateralSettings);
    }

    function updatePoolSettings(IVToken vToken, PoolSettings calldata newSettings) public onlyGovernanceOrTeamMultisig {
        protocol.pools[vToken].settings = newSettings;
        emit PoolSettingsUpdated(vToken, newSettings);
    }

    function updateProtocolSettings(
        LiquidationParams calldata _liquidationParams,
        uint256 _removeLimitOrderFee,
        uint256 _minimumOrderNotional,
        uint256 _minRequiredMargin
    ) external onlyGovernanceOrTeamMultisig {
        protocol.liquidationParams = _liquidationParams;
        protocol.removeLimitOrderFee = _removeLimitOrderFee;
        protocol.minimumOrderNotional = _minimumOrderNotional;
        protocol.minRequiredMargin = _minRequiredMargin;
    }

    function setPaused(bool _pause) external onlyGovernanceOrTeamMultisig {
        paused = _pause;
    }

    /// @inheritdoc IClearingHouseOwnerActions
    function withdrawProtocolFee(address[] calldata wrapperAddresses) external {
        uint256 totalProtocolFee;
        for (uint256 i = 0; i < wrapperAddresses.length; i++) {
            uint256 wrapperFee = IVPoolWrapper(wrapperAddresses[i]).collectAccruedProtocolFee();
            emit Account.ProtocolFeeWithdrawm(wrapperAddresses[i], wrapperFee);
            totalProtocolFee += wrapperFee;
        }
        protocol.rBase.safeTransfer(teamMultisig(), totalProtocolFee);
    }

    /**
        USER FUNCTIONS
     */

    /// @inheritdoc IClearingHouseActions
    function createAccount() public notPaused returns (uint256 newAccountId) {
        newAccountId = numAccounts;
        numAccounts = newAccountId + 1; // SSTORE

        Account.UserInfo storage newAccount = accounts[newAccountId];
        newAccount.owner = msg.sender;
        newAccount.tokenPositions.accountNo = newAccountId;

        emit Account.AccountCreated(msg.sender, newAccountId);
    }

    /// @inheritdoc IClearingHouseActions
    function addMargin(
        uint256 accountNo,
        uint32 cTokenTruncatedAddress,
        uint256 amount
    ) public notPaused {
        Account.UserInfo storage account = _getAccountAndCheckOwner(accountNo);
        _addMargin(accountNo, account, cTokenTruncatedAddress, amount);
    }

    function _getAccountAndCheckOwner(uint256 accountNo) internal view returns (Account.UserInfo storage account) {
        account = accounts[accountNo];
        if (msg.sender != account.owner) revert AccessDenied(msg.sender);
    }

    // done
    function _addMargin(
        uint256 accountNo,
        Account.UserInfo storage account,
        uint32 cTokenTruncatedAddress,
        uint256 amount
    ) internal notPaused {
        Collateral storage collateral = _getCTokenWithChecks(cTokenTruncatedAddress, true);

        collateral.token.safeTransferFrom(msg.sender, address(this), amount);

        account.addMargin(address(collateral.token), amount);

        emit Account.DepositMargin(accountNo, address(collateral.token), amount);
    }

    /// @inheritdoc IClearingHouseActions
    function createAccountAndAddMargin(uint32 vTokenTruncatedAddress, uint256 amount)
        external
        returns (uint256 newAccountId)
    {
        newAccountId = createAccount();
        addMargin(newAccountId, vTokenTruncatedAddress, amount);
    }

    /// @inheritdoc IClearingHouseActions
    function removeMargin(
        uint256 accountNo,
        uint32 cTokenTruncatedAddress,
        uint256 amount
    ) external notPaused {
        Account.UserInfo storage account = _getAccountAndCheckOwner(accountNo);
        _removeMargin(accountNo, account, cTokenTruncatedAddress, amount, true);
    }

    function _removeMargin(
        uint256 accountNo,
        Account.UserInfo storage account,
        uint32 cTokenTruncatedAddress,
        uint256 amount,
        bool checkMargin
    ) internal notPaused {
        Collateral storage collateral = _getCTokenWithChecks(cTokenTruncatedAddress, false);

        account.removeMargin(address(collateral.token), amount, protocol, checkMargin);

        collateral.token.safeTransfer(msg.sender, amount);

        emit Account.WithdrawMargin(accountNo, address(collateral.token), amount);
    }

    /// @inheritdoc IClearingHouseActions
    function updateProfit(uint256 accountNo, int256 amount) external notPaused {
        Account.UserInfo storage account = _getAccountAndCheckOwner(accountNo);

        _updateProfit(accountNo, account, amount, true);
    }

    function _updateProfit(
        uint256 accountNo,
        Account.UserInfo storage account,
        int256 amount,
        bool checkMargin
    ) internal notPaused {
        require(amount != 0, '!amount');

        account.updateProfit(amount, protocol, checkMargin);
        if (amount > 0) {
            protocol.rBase.safeTransferFrom(msg.sender, address(this), uint256(amount));
        } else {
            protocol.rBase.safeTransfer(msg.sender, uint256(-amount));
        }
        emit Account.UpdateProfit(accountNo, amount);
    }

    /// @inheritdoc IClearingHouseActions
    function swapToken(
        uint256 accountNo,
        uint32 vTokenTruncatedAddress,
        SwapParams memory swapParams
    ) external notPaused returns (int256 vTokenAmountOut, int256 vBaseAmountOut) {
        Account.UserInfo storage account = _getAccountAndCheckOwner(accountNo);
        return _swapToken(account, vTokenTruncatedAddress, swapParams, true);
    }

    function _swapToken(
        Account.UserInfo storage account,
        uint32 vTokenTruncatedAddress,
        SwapParams memory swapParams,
        bool checkMargin
    ) internal notPaused returns (int256 vTokenAmountOut, int256 vBaseAmountOut) {
        IVToken vToken = _getIVTokenWithChecks(vTokenTruncatedAddress);

        (vTokenAmountOut, vBaseAmountOut) = account.swapToken(vToken, swapParams, protocol, checkMargin);

        uint256 vBaseAmountOutAbs = uint256(vBaseAmountOut.abs());
        if (vBaseAmountOutAbs < protocol.minimumOrderNotional) revert LowNotionalValue(vBaseAmountOutAbs);

        if (swapParams.sqrtPriceLimit != 0 && !swapParams.isPartialAllowed) {
            if (
                !((swapParams.isNotional && vBaseAmountOut.abs() == swapParams.amount.abs()) ||
                    (!swapParams.isNotional && vTokenAmountOut.abs() == swapParams.amount.abs()))
            ) revert SlippageBeyondTolerance();
        }
    }

    /// @inheritdoc IClearingHouseActions
    function updateRangeOrder(
        uint256 accountNo,
        uint32 vTokenTruncatedAddress,
        LiquidityChangeParams calldata liquidityChangeParams
    ) external notPaused returns (int256 vTokenAmountOut, int256 vBaseAmountOut) {
        Account.UserInfo storage account = _getAccountAndCheckOwner(accountNo);

        return _updateRangeOrder(account, vTokenTruncatedAddress, liquidityChangeParams, true);
    }

    function _updateRangeOrder(
        Account.UserInfo storage account,
        uint32 vTokenTruncatedAddress,
        LiquidityChangeParams memory liquidityChangeParams,
        bool checkMargin
    ) internal notPaused returns (int256 vTokenAmountOut, int256 vBaseAmountOut) {
        IVToken vToken = _getIVTokenWithChecks(vTokenTruncatedAddress);

        if (liquidityChangeParams.sqrtPriceCurrent != 0) {
            _checkSlippage(vToken, liquidityChangeParams.sqrtPriceCurrent, liquidityChangeParams.slippageToleranceBps);
        }

        (vTokenAmountOut, vBaseAmountOut) = account.liquidityChange(
            vToken,
            liquidityChangeParams,
            protocol,
            checkMargin
        );

        uint256 notionalValueAbs = uint256(
            VTokenPositionSet.getNotionalValue(vToken, vTokenAmountOut, vBaseAmountOut, protocol)
        );

        if (notionalValueAbs < protocol.minimumOrderNotional) revert LowNotionalValue(notionalValueAbs);
    }

    /// @inheritdoc IClearingHouseActions
    function removeLimitOrder(
        uint256 accountNo,
        uint32 vTokenTruncatedAddress,
        int24 tickLower,
        int24 tickUpper
    ) external {
        _removeLimitOrder(accountNo, vTokenTruncatedAddress, tickLower, tickUpper, 0);
    }

    /// @inheritdoc IClearingHouseActions
    function liquidateLiquidityPositions(uint256 accountNo) external {
        _liquidateLiquidityPositions(accountNo, 0);
    }

    /// @inheritdoc IClearingHouseActions
    function liquidateTokenPosition(
        uint256 liquidatorAccountNo,
        uint256 accountNo,
        uint32 vTokenTruncatedAddress,
        uint16 liquidationBps
    ) external returns (BalanceAdjustments memory liquidatorBalanceAdjustments) {
        return _liquidateTokenPosition(liquidatorAccountNo, accountNo, vTokenTruncatedAddress, liquidationBps, 0);
    }

    /**
        MULTICALL
     */

    function multicallWithSingleMarginCheck(uint256 accountNo, MulticallOperation[] calldata operations)
        external
        returns (bytes[] memory results)
    {
        results = new bytes[](operations.length);

        Account.UserInfo storage account = _getAccountAndCheckOwner(accountNo);

        bool checkProfit = false;

        for (uint256 i = 0; i < operations.length; i++) {
            if (operations[i].operationType == MulticallOperationType.ADD_MARGIN) {
                // ADD_MARGIN
                (uint32 cTokenTruncatedAddress, uint256 amount) = abi.decode(operations[i].data, (uint32, uint256));
                _addMargin(accountNo, account, cTokenTruncatedAddress, amount);
            } else if (operations[i].operationType == MulticallOperationType.REMOVE_MARGIN) {
                // REMOVE_MARGIN
                (uint32 cTokenTruncatedAddress, uint256 amount) = abi.decode(operations[i].data, (uint32, uint256));
                _removeMargin(accountNo, account, cTokenTruncatedAddress, amount, false);
            } else if (operations[i].operationType == MulticallOperationType.UPDATE_PROFIT) {
                // UPDATE_PROFIT
                int256 amount = abi.decode(operations[i].data, (int256));
                _updateProfit(accountNo, account, amount, false);
                checkProfit = true;
            } else if (operations[i].operationType == MulticallOperationType.SWAP_TOKEN) {
                // SWAP_TOKEN
                (uint32 vTokenTruncatedAddress, SwapParams memory sp) = abi.decode(
                    operations[i].data,
                    (uint32, SwapParams)
                );
                (int256 vTokenAmountOut, int256 vBaseAmountOut) = _swapToken(
                    account,
                    vTokenTruncatedAddress,
                    sp,
                    false
                );
                results[i] = abi.encode(vTokenAmountOut, vBaseAmountOut);
            } else if (operations[i].operationType == MulticallOperationType.UPDATE_RANGE_ORDER) {
                // UPDATE_RANGE_ORDER
                (uint32 vTokenTruncatedAddress, LiquidityChangeParams memory lcp) = abi.decode(
                    operations[i].data,
                    (uint32, LiquidityChangeParams)
                );
                (int256 vTokenAmountOut, int256 vBaseAmountOut) = _updateRangeOrder(
                    account,
                    vTokenTruncatedAddress,
                    lcp,
                    false
                );
                results[i] = abi.encode(vTokenAmountOut, vBaseAmountOut);
            } else if (operations[i].operationType == MulticallOperationType.REMOVE_LIMIT_ORDER) {
                // REMOVE_LIMIT_ORDER
                (uint32 vTokenTruncatedAddress, int24 tickLower, int24 tickUpper, uint256 limitOrderFeeAndFixFee) = abi
                    .decode(operations[i].data, (uint32, int24, int24, uint256));
                _removeLimitOrder(accountNo, vTokenTruncatedAddress, tickLower, tickUpper, limitOrderFeeAndFixFee);
            } else if (operations[i].operationType == MulticallOperationType.LIQUIDATE_LIQUIDITY_POSITIONS) {
                // LIQUIDATE_LIQUIDITY_POSITIONS
                _liquidateLiquidityPositions(accountNo, 0);
            } else if (operations[i].operationType == MulticallOperationType.LIQUIDATE_TOKEN_POSITION) {
                // LIQUIDATE_TOKEN_POSITION
                (uint256 targetAccountNo, uint32 vTokenTruncatedAddress, uint16 liquidationBps) = abi.decode(
                    operations[i].data,
                    (uint256, uint32, uint16)
                );
                results[i] = abi.encode(
                    _liquidateTokenPosition(accountNo, targetAccountNo, vTokenTruncatedAddress, liquidationBps, 0)
                );
            } else {
                revert InvalidMulticallOperationType(operations[i].operationType);
            }
        }

        // after all the operations are done, check the margin requirements
        if (checkProfit) account.checkIfProfitAvailable(protocol); // TODO is this needed?
        account.checkIfMarginAvailable(true, protocol);

        return results;
    }

    /**
        ALTERNATE LIQUIDATION METHODS FOR FIX FEE CLAIM
     */

    function removeLimitOrderWithGasClaim(
        uint256 accountNo,
        uint32 vTokenTruncatedAddress,
        int24 tickLower,
        int24 tickUpper,
        uint256 gasComputationUnitsClaim
    ) external checkGasUsedClaim(gasComputationUnitsClaim) returns (uint256 keeperFee) {
        Calldata.limit(4 + 5 * 0x20);
        return _removeLimitOrder(accountNo, vTokenTruncatedAddress, tickLower, tickUpper, gasComputationUnitsClaim);
    }

    function liquidateLiquidityPositionsWithGasClaim(uint256 accountNo, uint256 gasComputationUnitsClaim)
        external
        checkGasUsedClaim(gasComputationUnitsClaim)
        returns (int256 keeperFee)
    {
        Calldata.limit(4 + 2 * 0x20);
        return _liquidateLiquidityPositions(accountNo, gasComputationUnitsClaim);
    }

    function liquidateTokenPositionWithGasClaim(
        uint256 liquidatorAccountNo,
        uint256 accountNo,
        uint32 vTokenTruncatedAddress,
        uint16 liquidationBps,
        uint256 gasComputationUnitsClaim
    )
        external
        checkGasUsedClaim(gasComputationUnitsClaim)
        returns (BalanceAdjustments memory liquidatorBalanceAdjustments)
    {
        Calldata.limit(4 + 5 * 0x20);
        return
            _liquidateTokenPosition(
                liquidatorAccountNo,
                accountNo,
                vTokenTruncatedAddress,
                liquidationBps,
                gasComputationUnitsClaim
            );
    }

    /**
        INTERNAL HELPERS
     */

    function _checkSlippage(
        IVToken vToken,
        uint160 sqrtPriceToCheck,
        uint16 slippageToleranceBps
    ) internal view {
        uint160 sqrtPriceCurrent = vToken.getVirtualCurrentSqrtPriceX96(protocol);
        uint160 diff = sqrtPriceCurrent > sqrtPriceToCheck
            ? sqrtPriceCurrent - sqrtPriceToCheck
            : sqrtPriceToCheck - sqrtPriceCurrent;
        if (diff > (slippageToleranceBps * sqrtPriceToCheck) / 1e4) {
            revert SlippageBeyondTolerance();
        }
    }

    function _getCTokenWithChecks(uint32 cTokenTruncatedAddress, bool checkSupported)
        internal
        view
        returns (Collateral storage collateral)
    {
        collateral = protocol.cTokens[cTokenTruncatedAddress];
        if (collateral.token.isZero()) revert UninitializedToken(cTokenTruncatedAddress); // TODO change to UninitializedCollateral
        if (checkSupported && !collateral.settings.supported) revert UnsupportedCToken(address(collateral.token));
    }

    function _getIVTokenWithChecks(uint32 vTokenTruncatedAddress) internal view returns (IVToken vToken) {
        vToken = protocol.vTokens[vTokenTruncatedAddress];
        if (vToken.eq(address(0))) revert UninitializedToken(vTokenTruncatedAddress); // TODO change to UninitializedVToken
        if (!protocol.pools[vToken].settings.supported) revert UnsupportedVToken(vToken);
    }

    function _liquidateLiquidityPositions(uint256 accountNo, uint256 gasComputationUnitsClaim)
        internal
        notPaused
        returns (int256 keeperFee)
    {
        Account.UserInfo storage account = accounts[accountNo];
        int256 insuranceFundFee;
        (keeperFee, insuranceFundFee) = account.liquidateLiquidityPositions(
            _getFixFee(gasComputationUnitsClaim),
            protocol
        );
        int256 accountFee = keeperFee + insuranceFundFee;

        if (keeperFee <= 0) revert KeeperFeeNotPositive(keeperFee);
        protocol.rBase.safeTransfer(msg.sender, uint256(keeperFee));
        _transferInsuranceFundFee(insuranceFundFee);

        emit Account.LiquidateRanges(accountNo, msg.sender, accountFee, keeperFee, insuranceFundFee);
    }

    function _liquidateTokenPosition(
        uint256 liquidatorAccountNo,
        uint256 accountNo,
        uint32 vTokenTruncatedAddress,
        uint16 liquidationBps,
        uint256 gasComputationUnitsClaim
    ) internal notPaused returns (BalanceAdjustments memory liquidatorBalanceAdjustments) {
        if (liquidationBps > 10000) revert InvalidTokenLiquidationParameters();
        Account.UserInfo storage account = accounts[accountNo];

        IVToken vToken = _getIVTokenWithChecks(vTokenTruncatedAddress);
        int256 insuranceFundFee;
        (insuranceFundFee, liquidatorBalanceAdjustments) = account.liquidateTokenPosition(
            accounts[liquidatorAccountNo],
            liquidationBps,
            vToken,
            _getFixFee(gasComputationUnitsClaim),
            protocol,
            true
        );

        _transferInsuranceFundFee(insuranceFundFee);
    }

    function _removeLimitOrder(
        uint256 accountNo,
        uint32 vTokenTruncatedAddress,
        int24 tickLower,
        int24 tickUpper,
        uint256 gasComputationUnitsClaim
    ) internal notPaused returns (uint256 keeperFee) {
        Account.UserInfo storage account = accounts[accountNo];

        IVToken vToken = _getIVTokenWithChecks(vTokenTruncatedAddress);
        keeperFee = protocol.removeLimitOrderFee + _getFixFee(gasComputationUnitsClaim);

        account.removeLimitOrder(vToken, tickLower, tickUpper, keeperFee, protocol);

        protocol.rBase.safeTransfer(msg.sender, keeperFee);
        // emit Account.LiqudityChange(accountNo, tickLower, tickUpper, liquidityDelta, 0, 0, 0);
    }

    function _transferInsuranceFundFee(int256 insuranceFundFee) internal {
        if (insuranceFundFee > 0) {
            protocol.rBase.safeTransfer(address(insuranceFund), uint256(insuranceFundFee));
        } else {
            insuranceFund.claim(uint256(-insuranceFundFee));
        }
    }

    function _updateCollateralSettings(IERC20 cToken, CollateralSettings memory collateralSettings) internal {
        uint32 truncated = cToken.truncate();

        // doesn't allow zero address as a collateral token
        if (cToken.isZero()) revert InvalidCollateralAddress(address(0));

        // doesn't allow owner to change the cToken address when updating settings, once it's truncated previously
        // TODO remove so many address() castings
        if (!protocol.cTokens[truncated].token.isZero() && !protocol.cTokens[truncated].token.eq(cToken)) {
            revert IncorrectCollateralAddress(cToken, protocol.cTokens[truncated].token);
        }

        protocol.cTokens[truncated] = Collateral(cToken, collateralSettings);

        emit CollateralSettingsUpdated(cToken, collateralSettings);
    }

    /// @notice Gets fix fee
    /// @dev Allowed to be overriden for specific chain implementations
    /// @return fixFee amount of fixFee in base
    function _getFixFee(uint256) internal view virtual returns (uint256 fixFee) {
        return 0;
    }
}
