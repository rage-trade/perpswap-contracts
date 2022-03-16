//Full Token Liquidation New

import { expect } from 'chai';
import hre from 'hardhat';
import { network } from 'hardhat';
import { ContractReceipt, ContractTransaction, ethers, providers } from 'ethers';

import { BigNumber, BigNumberish } from '@ethersproject/bignumber';

import { activateMainnetFork, deactivateMainnetFork } from './utils/mainnet-fork';
import { getCreateAddressFor } from './utils/create-addresses';
import {
  AccountTest,
  RageTradeFactory,
  ClearingHouse,
  ERC20,
  RealTokenMock,
  OracleMock,
  IERC20,
  ClearingHouseTest,
  IUniswapV3Pool,
  VPoolWrapperMockRealistic,
  VToken,
  VQuote,
  Account__factory,
  InsuranceFund,
  UniswapV3Pool,
  RealTokenMockDecimals,
} from '../typechain-types';

import { AccountInterface, TokenPositionChangedEvent } from '../typechain-types/Account';

// import { ConstantsStruct } from '../typechain-types/ClearingHouse';
import {
  UNISWAP_V3_FACTORY_ADDRESS,
  UNISWAP_V3_DEFAULT_FEE_TIER,
  UNISWAP_V3_POOL_BYTE_CODE_HASH,
  SETTLEMENT_TOKEN,
} from './utils/realConstants';

import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

import { config } from 'dotenv';
import { stealFunds, parseTokenAmount } from './utils/stealFunds';
import {
  sqrtPriceX96ToTick,
  priceToSqrtPriceX96WithoutContract,
  priceToTick,
  tickToPrice,
  tickToSqrtPriceX96,
  sqrtPriceX96ToPrice,
  priceToSqrtPriceX96,
  sqrtPriceX96ToPriceX128,
  priceX128ToPrice,
} from './utils/price-tick';

import { smock } from '@defi-wonderland/smock';
import { ADDRESS_ZERO, priceToClosestTick } from '@uniswap/v3-sdk';
import { FundingPaymentRealizedEvent } from '../typechain-types/Account';
import { truncate } from './utils/vToken';
const whaleFosettlementToken = '0x47ac0fb4f2d84898e4d9e7b4dab3c24507a6d503';

config();
const { ALCHEMY_KEY } = process.env;

describe('Clearing House Scenario 9 (Liquidation | Account Position | Full Liquidation Without Slippage Bound)', () => {
  let vQuoteAddress: string;
  let ownerAddress: string;
  let testContractAddress: string;
  let oracleAddress: string;
  // let constants: ConstantsStruct;
  let clearingHouseTest: ClearingHouseTest;
  let vPool: IUniswapV3Pool;
  let vPoolWrapper: VPoolWrapperMockRealistic;
  let vToken: VToken;
  let vQuote: VQuote;
  let rageTradeFactory: RageTradeFactory;

  let signers: SignerWithAddress[];
  let admin: SignerWithAddress;
  let user0: SignerWithAddress;
  let user1: SignerWithAddress;
  let user0AccountNo: BigNumberish;
  let user1AccountNo: BigNumberish;
  let user2: SignerWithAddress;
  let user2AccountNo: BigNumberish;
  let keeper: SignerWithAddress;
  let keeperAccountNo: BigNumberish;

  let settlementToken: IERC20;
  let settlementTokenOracle: OracleMock;

  let vTokenAddress: string;
  let vToken1Address: string;
  let dummyTokenAddress: string;

  let oracle: OracleMock;
  let oracle1: OracleMock;

  let realToken: RealTokenMockDecimals;
  let realToken1: RealTokenMockDecimals;

  let vPool1: IUniswapV3Pool;
  let vPoolWrapper1: VPoolWrapperMockRealistic;
  let vToken1: VToken;

  let initialBlockTimestamp: number;
  let insuranceFund: InsuranceFund;

  function X128ToDecimal(numX128: BigNumber, numDecimals: bigint) {
    return numX128.mul(10n ** numDecimals).div(1n << 128n);
  }
  async function closeTokenPosition(user: SignerWithAddress, accountNo: BigNumberish, vTokenAddress: string) {
    const truncatedAddress = await clearingHouseTest.getTruncatedTokenAddress(vTokenAddress);
    const accountTokenPosition = await clearingHouseTest.getAccountOpenTokenPosition(accountNo, vTokenAddress);

    const swapParams = {
      amount: accountTokenPosition.balance.mul(-1),
      sqrtPriceLimit: 0,
      isNotional: false,
      isPartialAllowed: false,
    };
    await clearingHouseTest.connect(user).swapToken(accountNo, truncatedAddress, swapParams);
  }

  async function cleanPositionsAllAccounts(accountNum: number) {
    let i;
    for (i = 0; i < accountNum; i++) {
      clearingHouseTest.cleanPositions(i);
    }
  }

  async function cleanDepositsAllAccounts(accountNum: number) {
    let i;
    for (i = 0; i < accountNum; i++) {
      clearingHouseTest.cleanDeposits(i);
    }
  }

  async function changeWrapperTimestampAndCheck(timestampIncrease: number) {
    const absoluteTimestamp = timestampIncrease + 100 + initialBlockTimestamp;
    await vPoolWrapper.setBlockTimestamp(absoluteTimestamp);
    await vPoolWrapper1.setBlockTimestamp(absoluteTimestamp);

    await network.provider.send('evm_setNextBlockTimestamp', [absoluteTimestamp]);
    expect(await vPoolWrapper.blockTimestamp()).to.eq(absoluteTimestamp);
    expect(await vPoolWrapper1.blockTimestamp()).to.eq(absoluteTimestamp);
  }
  async function checkVirtualTick(tokenPool: IUniswapV3Pool, expectedTick: number) {
    const { tick } = await tokenPool.slot0();
    expect(tick).to.eq(expectedTick);
  }

  async function checkVTokenBalance(accountNo: BigNumberish, vTokenAddress: string, vVTokenBalance: BigNumberish) {
    const vTokenPosition = await clearingHouseTest.getAccountOpenTokenPosition(accountNo, vTokenAddress);
    expect(vTokenPosition.balance).to.eq(vVTokenBalance);
  }

  async function checkVQuoteBalance(accountNo: BigNumberish, vQuoteBalance: BigNumberish) {
    const vQuoteBalance_ = await clearingHouseTest.getAccountQuoteBalance(accountNo);
    expect(vQuoteBalance_).to.eq(vQuoteBalance);
  }

  async function checkVTokenBalanceApproxiate(
    accountNo: BigNumberish,
    vTokenAddress: string,
    vVTokenBalance: BigNumberish,
    digitsToApproximate: BigNumberish,
  ) {
    const vTokenPosition = await clearingHouseTest.getAccountOpenTokenPosition(accountNo, vTokenAddress);
    expect(vTokenPosition.balance.sub(vVTokenBalance).abs()).lt(BigNumber.from(10).pow(digitsToApproximate));
  }

  async function checkTraderPosition(accountNo: BigNumberish, vTokenAddress: string, traderPosition: BigNumberish) {
    const vTokenPosition = await clearingHouseTest.getAccountOpenTokenPosition(accountNo, vTokenAddress);
    expect(vTokenPosition.netTraderPosition).to.eq(traderPosition);
  }

  async function checkTraderPositionApproximate(
    accountNo: BigNumberish,
    vTokenAddress: string,
    traderPosition: BigNumberish,
    digitsToApproximate: BigNumberish,
  ) {
    const vTokenPosition = await clearingHouseTest.getAccountOpenTokenPosition(accountNo, vTokenAddress);
    expect(vTokenPosition.netTraderPosition.sub(traderPosition).abs()).lt(BigNumber.from(10).pow(digitsToApproximate));
  }
  async function checkDepositBalance(accountNo: BigNumberish, vTokenAddress: string, vVTokenBalance: BigNumberish) {
    const balance = await clearingHouseTest.getAccountDepositBalance(accountNo, vTokenAddress);
    expect(balance).to.eq(vVTokenBalance);
  }

  async function checkSettlementVTokenBalance(address: string, vTokenAmount: BigNumberish) {
    expect(await settlementToken.balanceOf(address)).to.eq(vTokenAmount);
  }

  async function checkLiquidityPositionNum(accountNo: BigNumberish, vTokenAddress: string, num: BigNumberish) {
    const outNum = await clearingHouseTest.getAccountLiquidityPositionNum(accountNo, vTokenAddress);
    expect(outNum).to.eq(num);
  }

  async function checkLiquidityPositionDetails(
    accountNo: BigNumberish,
    vTokenAddress: string,
    num: BigNumberish,
    tickLower?: BigNumberish,
    tickUpper?: BigNumberish,
    limitOrderType?: BigNumberish,
    liquidity?: BigNumberish,
    sumALast?: BigNumberish,
    sumBInsideLast?: BigNumberish,
    sumFpInsideLast?: BigNumberish,
    sumFeeInsideLast?: BigNumberish,
  ) {
    const out = await clearingHouseTest.getAccountLiquidityPositionDetails(accountNo, vTokenAddress, num);
    if (typeof tickLower !== 'undefined') expect(out.tickLower).to.eq(tickLower);
    if (typeof tickUpper !== 'undefined') expect(out.tickUpper).to.eq(tickUpper);
    if (typeof limitOrderType !== 'undefined') expect(out.limitOrderType).to.eq(limitOrderType);
    if (typeof liquidity !== 'undefined') expect(out.liquidity).to.eq(liquidity);
    if (typeof sumALast !== 'undefined') expect(X128ToDecimal(out.sumALastX128, 10n)).to.eq(sumALast);
    if (typeof sumBInsideLast !== 'undefined') expect(X128ToDecimal(out.sumBInsideLastX128, 10n)).to.eq(sumBInsideLast);
    if (typeof sumFpInsideLast !== 'undefined')
      expect(X128ToDecimal(out.sumFpInsideLastX128, 10n)).to.eq(sumFpInsideLast);
    if (typeof sumFeeInsideLast !== 'undefined')
      expect(X128ToDecimal(out.sumFeeInsideLastX128, 10n)).to.eq(sumFeeInsideLast);
  }

  async function addMargin(
    user: SignerWithAddress,
    userAccountNo: BigNumberish,
    tokenAddress: string,
    vTokenAmount: BigNumberish,
  ) {
    await settlementToken.connect(user).approve(clearingHouseTest.address, vTokenAmount);
    const truncatedVQuoteAddress = await clearingHouseTest.getTruncatedTokenAddress(tokenAddress);
    await clearingHouseTest.connect(user).addMargin(userAccountNo, truncatedVQuoteAddress, vTokenAmount);
  }

  async function swapToken(
    user: SignerWithAddress,
    userAccountNo: BigNumberish,
    tokenAddress: string,
    amount: BigNumberish,
    sqrtPriceLimit: BigNumberish,
    isNotional: boolean,
    isPartialAllowed: boolean,
  ): Promise<ContractTransaction> {
    const truncatedAddress = await clearingHouseTest.getTruncatedTokenAddress(tokenAddress);
    const swapParams = {
      amount: amount,
      sqrtPriceLimit: sqrtPriceLimit,
      isNotional: isNotional,
      isPartialAllowed: isPartialAllowed,
    };
    return await clearingHouseTest.connect(user).swapToken(userAccountNo, truncatedAddress, swapParams);
  }

  async function checkTokenPositionChangeEvent(
    txnReceipt: ContractReceipt,
    expectedUserAccountNo: BigNumberish,
    expectedTokenAddress: string,
    expectedTokenAmountOut: BigNumberish,
    expectedVQuoteAmountOut: BigNumberish,
  ) {
    const eventList = txnReceipt.logs
      ?.map(log => {
        try {
          return {
            ...log,
            ...Account__factory.connect(ethers.constants.AddressZero, hre.ethers.provider).interface.parseLog(log),
          };
        } catch {
          return null;
        }
      })
      .filter(event => event !== null)
      .filter(event => event?.name === 'TokenPositionChanged') as unknown as TokenPositionChangedEvent[];

    const event = eventList[0];
    expect(event.args.accountId).to.eq(expectedUserAccountNo);
    expect(event.args.poolId).to.eq(Number(truncate(expectedTokenAddress)));
    expect(event.args.vTokenAmountOut).to.eq(expectedTokenAmountOut);
    expect(event.args.vQuoteAmountOut).to.eq(expectedVQuoteAmountOut);
  }

  async function checkFundingPaymentEvent(
    txnReceipt: ContractReceipt,
    expectedUserAccountNo: BigNumberish,
    expectedTokenAddress: string,
    expectedTickLower: BigNumberish,
    expectedTickUpper: BigNumberish,
    expectedFundingPayment: BigNumberish,
  ) {
    const eventList = txnReceipt.logs
      ?.map(log => {
        try {
          return {
            ...log,
            ...Account__factory.connect(ethers.constants.AddressZero, hre.ethers.provider).interface.parseLog(log),
          };
        } catch {
          return null;
        }
      })
      .filter(event => event !== null)
      .filter(event => event?.name === 'FundingPaymentRealized') as unknown as FundingPaymentRealizedEvent[];

    const event = eventList[0];

    expect(event.args.accountId).to.eq(expectedUserAccountNo);
    expect(event.args.poolId).to.eq(Number(truncate(expectedTokenAddress)));
    expect(event.args.tickLower).to.eq(expectedTickLower);
    expect(event.args.tickUpper).to.eq(expectedTickUpper);
    expect(event.args.amount).to.eq(expectedFundingPayment);
  }

  async function checkSwapEvents(
    swapTxn: ContractTransaction,
    expectedUserAccountNo: BigNumberish,
    expectedTokenAddress: string,
    expectedTokenAmountOut: BigNumberish,
    expectedVQuoteAmountOutWithFee: BigNumberish,
    expectedFundingPayment: BigNumberish,
  ) {
    const swapReceipt = await swapTxn.wait();

    await checkTokenPositionChangeEvent(
      swapReceipt,
      expectedUserAccountNo,
      expectedTokenAddress,
      expectedTokenAmountOut,
      expectedVQuoteAmountOutWithFee,
    );
    await checkFundingPaymentEvent(
      swapReceipt,
      expectedUserAccountNo,
      expectedTokenAddress,
      0,
      0,
      expectedFundingPayment,
    );
  }

  async function swapTokenAndCheck(
    user: SignerWithAddress,
    userAccountNo: BigNumberish,
    tokenPool: IUniswapV3Pool,
    tokenAddress: string,
    vQuoteAddress: string,
    amount: BigNumberish,
    sqrtPriceLimit: BigNumberish,
    isNotional: boolean,
    isPartialAllowed: boolean,
    expectedStartTick: number,
    expectedEndTick: number,
    expectedEndVTokenBalance: BigNumberish,
    expectedEndVQuoteBalance: BigNumberish,
    expectedTokenAmountOut: BigNumberish,
    expectedVQuoteAmountOutWithFee: BigNumberish,
    expectedFundingPayment: BigNumberish,
  ): Promise<ContractTransaction> {
    await checkVirtualTick(tokenPool, expectedStartTick);
    const swapTxn = await swapToken(
      user,
      userAccountNo,
      tokenAddress,
      amount,
      sqrtPriceLimit,
      isNotional,
      isPartialAllowed,
    );

    await checkVirtualTick(tokenPool, expectedEndTick);
    await checkVTokenBalance(userAccountNo, tokenAddress, expectedEndVTokenBalance);
    await checkVQuoteBalance(userAccountNo, expectedEndVQuoteBalance);
    await checkSwapEvents(
      swapTxn,
      userAccountNo,
      tokenAddress,
      expectedTokenAmountOut,
      expectedVQuoteAmountOutWithFee,
      expectedFundingPayment,
    );
    return swapTxn;
  }

  async function checkLiquidityPositionUnrealizedFundingPaymentAndFee(
    userAccountNo: BigNumberish,
    tokenAddress: string,
    num: BigNumberish,
    expectedUnrealizedFundingPayment: BigNumberish,
    expectedUnrealizedFee: BigNumberish,
  ) {
    const out = await clearingHouseTest.getAccountLiquidityPositionFundingAndFee(userAccountNo, tokenAddress, num);
    expect(out.unrealizedLiquidityFee).to.eq(expectedUnrealizedFee);
    expect(out.fundingPayment).to.eq(expectedUnrealizedFundingPayment);
  }

  async function checkTraderPositionUnrealizedFundingPayment(
    userAccountNo: BigNumberish,
    tokenAddress: string,
    expectedUnrealizedFundingPayment: BigNumberish,
  ) {
    const fundingPayment = await clearingHouseTest.getAccountTokenPositionFunding(userAccountNo, tokenAddress);
    console.log('Token Position Funding');
    console.log(fundingPayment.toBigInt());
    // expect(fundingPayment).to.eq(expectedUnrealizedFundingPayment);
  }

  async function updateRangeOrder(
    user: SignerWithAddress,
    userAccountNo: BigNumberish,
    tokenAddress: string,
    tickLower: BigNumberish,
    tickUpper: BigNumberish,
    liquidityDelta: BigNumberish,
    closeTokenPosition: boolean,
    limitOrderType: number,
  ) {
    const truncatedAddress = await clearingHouseTest.getTruncatedTokenAddress(tokenAddress);

    let liquidityChangeParams = {
      tickLower: tickLower,
      tickUpper: tickUpper,
      liquidityDelta: liquidityDelta,
      sqrtPriceCurrent: 0,
      slippageToleranceBps: 0,
      closeTokenPosition: closeTokenPosition,
      limitOrderType: limitOrderType,
    };

    await clearingHouseTest.connect(user).updateRangeOrder(userAccountNo, truncatedAddress, liquidityChangeParams);
  }

  async function updateRangeOrderAndCheck(
    user: SignerWithAddress,
    userAccountNo: BigNumberish,
    tokenAddress: string,
    vQuoteAddress: string,
    tickLower: BigNumberish,
    tickUpper: BigNumberish,
    liquidityDelta: BigNumberish,
    closeTokenPosition: boolean,
    limitOrderType: number,
    liquidityPositionNum: BigNumberish,
    expectedEndLiquidityPositionNum: BigNumberish,
    expectedEndVTokenBalance: BigNumberish,
    expectedEndVQuoteBalance: BigNumberish,
    checkApproximateVTokenBalance: Boolean,
    expectedSumALast?: BigNumberish,
    expectedSumBLast?: BigNumberish,
    expectedSumFpLast?: BigNumberish,
    expectedSumFeeLast?: BigNumberish,
  ) {
    await updateRangeOrder(
      user,
      userAccountNo,
      tokenAddress,
      tickLower,
      tickUpper,
      liquidityDelta,
      closeTokenPosition,
      limitOrderType,
    );
    checkApproximateVTokenBalance
      ? await checkVTokenBalanceApproxiate(userAccountNo, tokenAddress, expectedEndVTokenBalance, 12)
      : await checkVTokenBalance(userAccountNo, tokenAddress, expectedEndVTokenBalance);
    await checkVQuoteBalance(userAccountNo, expectedEndVQuoteBalance);
    await checkLiquidityPositionNum(userAccountNo, tokenAddress, expectedEndLiquidityPositionNum);
    if (liquidityPositionNum !== -1) {
      await checkLiquidityPositionDetails(
        userAccountNo,
        tokenAddress,
        liquidityPositionNum,
        tickLower,
        tickUpper,
        limitOrderType,
        liquidityDelta,
      );
    }
  }

  async function logPoolPrice(pool: IUniswapV3Pool, token: VToken) {
    const { sqrtPriceX96 } = await pool.slot0();
    console.log(await sqrtPriceX96ToPrice(sqrtPriceX96, vQuote, token));
  }

  async function checkGlobalParams(
    expectedSumB?: BigNumberish,
    expectedSumA?: BigNumberish,
    expectedSumFp?: BigNumberish,
    expectedSumFee?: BigNumberish,
  ) {
    const fpGlobal = await vPoolWrapper.fpGlobal();
    const sumFeeX128 = await vPoolWrapper.sumFeeGlobalX128();
    //Already a multiple of e6 since token(e18) and liquidity(e12)
    if (typeof expectedSumB !== 'undefined') {
      const sumB = X128ToDecimal(fpGlobal.sumBX128, 10n);
      expect(sumB).to.eq(expectedSumB);
    }
    //Already a multiple of e-12 since token price has that multiple
    if (typeof expectedSumA !== 'undefined') {
      const sumA = X128ToDecimal(fpGlobal.sumAX128, 20n);
      expect(sumA).to.eq(expectedSumA);
    }
    //Already a multiple of e-6 since Fp = a*sumB
    if (typeof expectedSumFp !== 'undefined') {
      const sumFp = X128ToDecimal(fpGlobal.sumFpX128, 19n);
      expect(sumFp).to.eq(expectedSumFp);
    }

    if (typeof expectedSumFee !== 'undefined') {
      const sumFee = X128ToDecimal(sumFeeX128, 16n);
      expect(sumFee).to.eq(expectedSumFee);
    }
  }

  async function checkTickParams(
    tickIndex: BigNumberish,
    expectedSumB?: BigNumberish,
    expectedSumA?: BigNumberish,
    expectedSumFp?: BigNumberish,
    expectedSumFee?: BigNumberish,
  ) {
    const tick = await vPoolWrapper.ticksExtended(tickIndex);

    // console.log('#### Tick Params ####');
    // console.log(tickIndex);
    // console.log(X128ToDecimal(tick.sumBOutsideX128, 10n).toBigInt());
    // console.log(X128ToDecimal(tick.sumALastX128, 20n).toBigInt());
    // console.log(X128ToDecimal(tick.sumFpOutsideX128, 19n).toBigInt());
    // console.log(X128ToDecimal(tick.sumFeeOutsideX128, 16n).toBigInt());

    //Already a multiple of e6 since token(e18) and liquidity(e12)
    if (typeof expectedSumB !== 'undefined') {
      const sumB = X128ToDecimal(tick.sumBOutsideX128, 10n);
      expect(sumB).to.eq(expectedSumB);
    }
    //Already a multiple of e-12 since token price has that multiple
    if (typeof expectedSumA !== 'undefined') {
      const sumA = X128ToDecimal(tick.sumALastX128, 20n);
      expect(sumA).to.eq(expectedSumA);
    }
    //Already a multiple of e-6 since Fp = a*sumB
    if (typeof expectedSumFp !== 'undefined') {
      const sumFp = X128ToDecimal(tick.sumFpOutsideX128, 19n);
      expect(sumFp).to.eq(expectedSumFp);
    }

    if (typeof expectedSumFee !== 'undefined') {
      const sumFee = X128ToDecimal(tick.sumFeeOutsideX128, 16n);
      expect(sumFee).to.eq(expectedSumFee);
    }
  }

  async function removeLimitOrder(
    keeper: SignerWithAddress,
    userAccountNo: BigNumberish,
    tokenAddress: string,
    tickLower: BigNumberish,
    tickUpper: BigNumberish,
  ) {
    const truncatedAddress = await clearingHouseTest.getTruncatedTokenAddress(tokenAddress);
    await clearingHouseTest.connect(keeper).removeLimitOrder(userAccountNo, truncatedAddress, tickLower, tickUpper);
  }

  async function removeLimitOrderAndCheck(
    keeper: SignerWithAddress,
    userAccountNo: BigNumberish,
    tokenAddress: string,
    vQuoteAddress: string,
    tickLower: BigNumberish,
    tickUpper: BigNumberish,
    expectedEndLiquidityPositionNum: BigNumberish,
    expectedEndVTokenBalance: BigNumberish,
    expectedEndVQuoteBalance: BigNumberish,
    checkApproximateVTokenBalance: Boolean,
  ) {
    await removeLimitOrder(keeper, userAccountNo, tokenAddress, tickLower, tickUpper);
    checkApproximateVTokenBalance
      ? await checkVTokenBalanceApproxiate(userAccountNo, tokenAddress, expectedEndVTokenBalance, 9)
      : await checkVTokenBalance(userAccountNo, tokenAddress, expectedEndVTokenBalance);
    await checkVQuoteBalance(userAccountNo, expectedEndVQuoteBalance);
    await checkLiquidityPositionNum(userAccountNo, tokenAddress, expectedEndLiquidityPositionNum);
  }

  async function liquidateLiquidityPositions(keeper: SignerWithAddress, userAccountNo: BigNumberish) {
    await clearingHouseTest.connect(keeper).liquidateLiquidityPositions(userAccountNo);
  }

  async function liquidateTokenPosition(keeper: SignerWithAddress, userAccountNo: BigNumberish, tokenAddress: string) {
    const truncatedAddress = await clearingHouseTest.getTruncatedTokenAddress(tokenAddress);
    await clearingHouseTest.connect(keeper).liquidateTokenPosition(userAccountNo, truncatedAddress);
  }

  async function liquidateTokenPositionAndCheck(
    keeper: SignerWithAddress,
    userAccountNo: BigNumberish,
    tokenAddress: string,
  ) {
    const truncatedAddress = await clearingHouseTest.getTruncatedTokenAddress(tokenAddress);
    await clearingHouseTest.connect(keeper).liquidateTokenPosition(userAccountNo, truncatedAddress);
  }

  async function initializePool(
    tokenName: string,
    tokenSymbol: string,
    decimals: BigNumberish,
    rageTradeFactory: RageTradeFactory,
    initialMarginRatio: BigNumberish,
    maintainanceMarginRatio: BigNumberish,
    twapDuration: BigNumberish,
    initialPrice: BigNumberish,
    lpFee: BigNumberish,
    protocolFee: BigNumberish,
  ) {
    const realTokenFactory = await hre.ethers.getContractFactory('RealTokenMockDecimals');
    const realToken = await realTokenFactory.deploy(decimals);

    const oracleFactory = await hre.ethers.getContractFactory('OracleMock');
    const oracle = await oracleFactory.deploy();

    await oracle.setSqrtPriceX96(initialPrice);

    // await VPoolFactory.initializePool(
    //   {
    //     setupVTokenParams: {
    //       vTokenName: tokenName,
    //       vTokenSymbol: tokenSymbol,
    //       realTokenAddress: realToken.address,
    //       oracleAddress: oracle.address,
    //     },
    //     extendedLpFee: lpFee,
    //     protocolFee: protocolFee,
    //     initialMarginRatio,
    //     maintainanceMarginRatio,
    //     twapDuration,
    //     whitelisted: false,
    //   },
    //   0,
    // );

    await rageTradeFactory.initializePool({
      deployVTokenParams: {
        vTokenName: tokenName,
        vTokenSymbol: tokenSymbol,
        cTokenDecimals: decimals,
      },
      poolInitialSettings: {
        initialMarginRatio,
        maintainanceMarginRatio,
        twapDuration,
        isAllowedForTrade: false,
        isCrossMargined: false,
        oracle: oracle.address,
      },
      liquidityFeePips: lpFee,
      protocolFeePips: protocolFee,
      slotsToInitialize: 100,
    });

    const eventFilter = rageTradeFactory.filters.PoolInitialized();
    const events = await rageTradeFactory.queryFilter(eventFilter);
    const eventNum = events.length - 1;
    const vPool = events[eventNum].args[0];
    const vTokenAddress = events[eventNum].args[1];
    const vPoolWrapper = events[eventNum].args[2];

    return { vTokenAddress, realToken, oracle, vPool, vPoolWrapper };
  }

  async function deployWrappers(rageTradeFactory: RageTradeFactory) {
    const initialMargin = 20_000;
    const maintainanceMargin = 10_000;
    const twapDuration = 300;
    const initialPrice = tickToSqrtPriceX96(-197830);
    const initialPrice1 = tickToSqrtPriceX96(64197);

    const lpFee = 1000;
    const protocolFee = 500;

    let out = await initializePool(
      'VETH',
      'VETH',
      18,
      rageTradeFactory,
      initialMargin,
      maintainanceMargin,
      twapDuration,
      initialPrice,
      lpFee,
      protocolFee,
    );

    vTokenAddress = out.vTokenAddress;
    oracle = out.oracle;
    realToken = out.realToken;
    vPool = (await hre.ethers.getContractAt(
      '@uniswap/v3-core-0.8-support/contracts/interfaces/IUniswapV3Pool.sol:IUniswapV3Pool',
      out.vPool,
    )) as IUniswapV3Pool;
    vToken = await hre.ethers.getContractAt('VToken', vTokenAddress);

    const vPoolWrapperAddress = out.vPoolWrapper;

    vPoolWrapper = await hre.ethers.getContractAt('VPoolWrapperMockRealistic', vPoolWrapperAddress);

    // increases cardinality for twap
    await vPool.increaseObservationCardinalityNext(100);

    // Another token initialization
    let out1 = await initializePool(
      'vBTC',
      'vBTC',
      8,
      rageTradeFactory,
      initialMargin,
      maintainanceMargin,
      twapDuration,
      initialPrice1,
      lpFee,
      protocolFee,
    );

    vToken1Address = out1.vTokenAddress;
    oracle1 = out1.oracle;
    realToken1 = out1.realToken;
    vPool1 = (await hre.ethers.getContractAt(
      '@uniswap/v3-core-0.8-support/contracts/interfaces/IUniswapV3Pool.sol:IUniswapV3Pool',
      out1.vPool,
    )) as IUniswapV3Pool;
    vToken1 = await hre.ethers.getContractAt('VToken', vToken1Address);

    const vPoolWrapper1Address = out1.vPoolWrapper;

    vPoolWrapper1 = await hre.ethers.getContractAt('VPoolWrapperMockRealistic', vPoolWrapper1Address);

    // increases cardinality for twap
    await vPool1.increaseObservationCardinalityNext(100);
  }

  async function deployClearingHouse() {
    const futureVPoolFactoryAddress = await getCreateAddressFor(admin, 3);
    const futureInsurnaceFundAddress = await getCreateAddressFor(admin, 4);

    // const VPoolWrapperDeployer = await (
    //   await hre.ethers.getContractFactory('VPoolWrapperDeployer')
    // ).deploy(futureVPoolFactoryAddress);
    const vPoolWrapperLogic = await (await hre.ethers.getContractFactory('VPoolWrapperMockRealistic')).deploy();

    const accountLib = await (await hre.ethers.getContractFactory('Account')).deploy();
    const clearingHouseTestLogic = await (
      await hre.ethers.getContractFactory('ClearingHouseTest', {
        libraries: {
          Account: accountLib.address,
        },
      })
    ).deploy();

    const insuranceFundLogic = await (await hre.ethers.getContractFactory('InsuranceFund')).deploy();

    const nativeOracle = await (await hre.ethers.getContractFactory('OracleMock')).deploy();

    rageTradeFactory = await (
      await hre.ethers.getContractFactory('RageTradeFactory')
    ).deploy(
      clearingHouseTestLogic.address,
      vPoolWrapperLogic.address,
      insuranceFundLogic.address,
      settlementToken.address,
      nativeOracle.address,
    );

    clearingHouseTest = await hre.ethers.getContractAt('ClearingHouseTest', await rageTradeFactory.clearingHouse());

    insuranceFund = await hre.ethers.getContractAt('InsuranceFund', await clearingHouseTest.insuranceFund());

    vQuote = await hre.ethers.getContractAt('VQuote', await rageTradeFactory.vQuote());
    vQuoteAddress = vQuote.address;

    // await vQuote.transferOwnership(VPoolFactory.address);
    settlementTokenOracle = await (await hre.ethers.getContractFactory('OracleMock')).deploy();
    await clearingHouseTest.updateCollateralSettings(settlementToken.address, {
      oracle: settlementTokenOracle.address,
      twapDuration: 300,
      isAllowedForDeposit: true,
    });

    await deployWrappers(rageTradeFactory);

    const block = await hre.ethers.provider.getBlock('latest');
    initialBlockTimestamp = block.timestamp;
  }

  async function getPoolSettings(vTokenAddress: string) {
    let {
      settings: {
        initialMarginRatio,
        maintainanceMarginRatio,
        twapDuration,
        isAllowedForTrade,
        isCrossMargined,
        oracle,
      },
    } = await clearingHouseTest.getPoolInfo(truncate(vTokenAddress));
    return { initialMarginRatio, maintainanceMarginRatio, twapDuration, isAllowedForTrade, isCrossMargined, oracle };
  }

  before(async () => {
    await activateMainnetFork();

    dummyTokenAddress = ethers.utils.hexZeroPad(BigNumber.from(148392483294).toHexString(), 20);

    settlementToken = await hre.ethers.getContractAt('IERC20', SETTLEMENT_TOKEN);

    // const vQuoteFactory = await hre.ethers.getContractFactory('VQuote');
    // vQuote = await vQuoteFactory.deploy(SETTLEMENT_TOKEN);
    // vQuoteAddress = vQuote.address;

    signers = await hre.ethers.getSigners();

    admin = signers[0];
    user0 = signers[1];
    user1 = signers[2];
    user2 = signers[3];
    keeper = signers[4];

    await deployClearingHouse();
  });

  after(deactivateMainnetFork);

  describe('#Init Params', () => {
    it('Set Params', async () => {
      const liquidationParams = {
        rangeLiquidationFeeFraction: 1500,
        tokenLiquidationFeeFraction: 3000,
        insuranceFundFeeShareBps: 5000,
        maxRangeLiquidationFees: 100000000,
        closeFactorMMThresholdBps: 7500,
        partialLiquidationCloseFactorBps: 5000,
        liquidationSlippageSqrtToleranceBps: 150,
        minNotionalLiquidatable: 100000000,
      };
      const fixFee = parseTokenAmount(0, 6);
      const removeLimitOrderFee = parseTokenAmount(10, 6);
      const minimumOrderNotional = parseTokenAmount(1, 6).div(100);
      const minRequiredMargin = parseTokenAmount(20, 6);

      await clearingHouseTest.updateProtocolSettings(
        liquidationParams,
        removeLimitOrderFee,
        minimumOrderNotional,
        minRequiredMargin,
      );
      await clearingHouseTest.setFixFee(fixFee);
      const protocol = await clearingHouseTest.protocolInfo();
      const curPaused = await clearingHouseTest.paused();

      expect(await clearingHouseTest.fixFee()).eq(fixFee);
      expect(protocol.minRequiredMargin).eq(minRequiredMargin);

      expect(protocol.liquidationParams.rangeLiquidationFeeFraction).eq(liquidationParams.rangeLiquidationFeeFraction);
      expect(protocol.liquidationParams.tokenLiquidationFeeFraction).eq(liquidationParams.tokenLiquidationFeeFraction);

      expect(protocol.liquidationParams.insuranceFundFeeShareBps).eq(liquidationParams.insuranceFundFeeShareBps);

      expect(protocol.removeLimitOrderFee).eq(removeLimitOrderFee);
      expect(protocol.minimumOrderNotional).eq(minimumOrderNotional);
      expect(curPaused).to.be.false;

      // await vPoolWrapper.setFpGlobalLastTimestamp(0);
      // await vPoolWrapper1.setFpGlobalLastTimestamp(0);
    });
  });

  describe('#Initialize', () => {
    it('Steal Funds', async () => {
      await stealFunds(SETTLEMENT_TOKEN, 6, user0.address, '5000000', whaleFosettlementToken);
      await stealFunds(SETTLEMENT_TOKEN, 6, user1.address, '5000000', whaleFosettlementToken);
      await stealFunds(SETTLEMENT_TOKEN, 6, user2.address, '10000000', whaleFosettlementToken);
      await stealFunds(SETTLEMENT_TOKEN, 6, keeper.address, '1000000', whaleFosettlementToken);

      expect(await settlementToken.balanceOf(user0.address)).to.eq(parseTokenAmount('5000000', 6));
      expect(await settlementToken.balanceOf(user1.address)).to.eq(parseTokenAmount('5000000', 6));
      expect(await settlementToken.balanceOf(user2.address)).to.eq(parseTokenAmount('10000000', 6));
      expect(await settlementToken.balanceOf(keeper.address)).to.eq(parseTokenAmount('1000000', 6));
    });
    it('Create Account - 1', async () => {
      await clearingHouseTest.connect(user0).createAccount();
      user0AccountNo = 0;
      expect(await clearingHouseTest.numAccounts()).to.eq(1);
      expect(await clearingHouseTest.getAccountOwner(user0AccountNo)).to.eq(user0.address);
      // expect(await clearingHouseTest.getAccountNumInTokenPositionSet(user0AccountNo)).to.eq(user0AccountNo);
    });
    it('Create Account - 2', async () => {
      await clearingHouseTest.connect(user1).createAccount();
      user1AccountNo = 1;
      expect(await clearingHouseTest.numAccounts()).to.eq(2);
      expect(await clearingHouseTest.getAccountOwner(user1AccountNo)).to.eq(user1.address);
      // expect(await clearingHouseTest.getAccountNumInTokenPositionSet(user1AccountNo)).to.eq(user1AccountNo);
    });
    it('Create Account - 3', async () => {
      await clearingHouseTest.connect(user2).createAccount();
      user2AccountNo = 2;
      expect(await clearingHouseTest.numAccounts()).to.eq(3);
      expect(await clearingHouseTest.getAccountOwner(user2AccountNo)).to.eq(user2.address);
      // expect(await clearingHouseTest.getAccountNumInTokenPositionSet(user2AccountNo)).to.eq(user2AccountNo);
    });

    it('Create Account - Keeper', async () => {
      await clearingHouseTest.connect(keeper).createAccount();
      keeperAccountNo = 3;
      expect(await clearingHouseTest.numAccounts()).to.eq(4);
      expect(await clearingHouseTest.getAccountOwner(keeperAccountNo)).to.eq(keeper.address);
      // expect(await clearingHouseTest.getAccountNumInTokenPositionSet(keeperAccountNo)).to.eq(keeperAccountNo);
    });

    it('Tokens Intialized', async () => {
      expect(await clearingHouseTest.getTokenAddressInVTokens(vTokenAddress)).to.eq(vTokenAddress);
    });

    it('Add Token 1 Position Support - Pass', async () => {
      const settings = await getPoolSettings(vTokenAddress);
      settings.isAllowedForTrade = true;
      await clearingHouseTest.connect(admin).updatePoolSettings(truncate(vTokenAddress), settings);
      expect((await clearingHouseTest.getPoolInfo(truncate(vTokenAddress))).settings.isAllowedForTrade).to.be.true;
    });

    it('Add Token 2 Position Support - Pass', async () => {
      const settings = await getPoolSettings(vToken1Address);
      settings.isAllowedForTrade = true;
      await clearingHouseTest.connect(admin).updatePoolSettings(truncate(vToken1Address), settings);
      expect((await clearingHouseTest.getPoolInfo(truncate(vToken1Address))).settings.isAllowedForTrade).to.be.true;
    });

    it('AddVQuote Deposit Support  - Pass', async () => {
      // await clearingHouseTest.connect(admin).updateSupportedDeposits(settlementToken.address, true);
      expect(
        (await clearingHouseTest.getCollateralInfo(truncate(settlementToken.address))).settings.isAllowedForDeposit,
      ).to.be.true;
    });
  });

  describe('#Collateral Deposit', async () => {
    after(async () => {
      await cleanPositionsAllAccounts(4);
    });
    it('Acct[0] Initial Collateral Deposit = 5M USDC', async () => {
      await addMargin(user0, user0AccountNo, settlementToken.address, parseTokenAmount(5n * 10n ** 6n, 6));
      await checkSettlementVTokenBalance(user0.address, parseTokenAmount(0n, 6));
      await checkSettlementVTokenBalance(clearingHouseTest.address, parseTokenAmount(5n * 10n ** 6n, 6));
      await checkDepositBalance(user0AccountNo, settlementToken.address, parseTokenAmount(5n * 10n ** 6n, 6));
    });

    it('Acct[1] Initial Collateral Deposit = 100K USDC', async () => {
      await addMargin(user1, user1AccountNo, settlementToken.address, parseTokenAmount(6n * 10n ** 4n, 6));
      await checkSettlementVTokenBalance(user1.address, parseTokenAmount(5n * 10n ** 6n - 6n * 10n ** 4n, 6));
      await checkSettlementVTokenBalance(
        clearingHouseTest.address,
        parseTokenAmount(5n * 10n ** 6n + 6n * 10n ** 4n, 6),
      );
      await checkDepositBalance(user1AccountNo, settlementToken.address, parseTokenAmount(6n * 10n ** 4n, 6));
    });

    it('Acct[2] Initial Collateral Deposit = 10m USDC', async () => {
      await addMargin(user2, user2AccountNo, settlementToken.address, parseTokenAmount(10n ** 7n, 6));
      await checkSettlementVTokenBalance(user2.address, parseTokenAmount(0n, 6));
      await checkSettlementVTokenBalance(
        clearingHouseTest.address,
        parseTokenAmount(15n * 10n ** 6n + 6n * 10n ** 4n, 6),
      );
      await checkDepositBalance(user2AccountNo, settlementToken.address, parseTokenAmount(10n ** 7n, 6));
    });

    it('Keeper Initial Collateral Deposit = 1m USDC', async () => {
      await addMargin(keeper, keeperAccountNo, settlementToken.address, parseTokenAmount(10n ** 6n, 6));
      await checkSettlementVTokenBalance(keeper.address, parseTokenAmount(0n, 6));
      await checkSettlementVTokenBalance(
        clearingHouseTest.address,
        parseTokenAmount(16n * 10n ** 6n + 6n * 10n ** 4n, 6),
      );
      await checkDepositBalance(keeperAccountNo, settlementToken.address, parseTokenAmount(10n ** 6n, 6));
    });
  });

  describe('#Scenario Partial Token Liquidation', async () => {
    before(async () => {
      const block = await hre.ethers.provider.getBlock('latest');
      initialBlockTimestamp = block.timestamp;
    });
    after(async () => {
      await cleanPositionsAllAccounts(4);
    });

    it('Timestamp And Oracle Update - 0', async () => {
      await changeWrapperTimestampAndCheck(0);
      const realSqrtPrice = await priceToSqrtPriceX96(2565.7603591698, vQuote, vToken);
      await oracle.setSqrtPriceX96(realSqrtPrice);
    });

    it('Acct[0] Adds Liq to ETH Pool b/w ticks (-200000 to -195000) @ tickCurrent = -197830', async () => {
      const tickLower = -200000;
      const tickUpper = -195000;
      const liquidityDelta = 400000000000000000n;
      const limitOrderType = 0;
      const expectedToken2Balance = -1042416382071960000000n;
      const expectedVQuoteBalance = -2082152865219n + 5n;

      const expectedSumALast = 0n;
      const expectedSumBLast = 0n;
      const expectedSumFpLast = 0n;
      const expectedSumFeeLast = 0n;

      await updateRangeOrderAndCheck(
        user0,
        user0AccountNo,
        vTokenAddress,
        vQuoteAddress,
        tickLower,
        tickUpper,
        liquidityDelta,
        false,
        limitOrderType,
        0,
        1,
        expectedToken2Balance,
        expectedVQuoteBalance,
        true,
        expectedSumALast,
        expectedSumBLast,
        expectedSumFpLast,
        expectedSumFeeLast,
      );
    });

    it('Timestamp and Oracle Update - 1000', async () => {
      await changeWrapperTimestampAndCheck(1000);
      const realSqrtPrice = await priceToSqrtPriceX96(2565.7603591698, vQuote, vToken);
      await oracle.setSqrtPriceX96(realSqrtPrice);
    });

    it('Acct[1] Short ETH : Price Changes (StartTick = -197830, EndTick = -198080)', async () => {
      const startTick = -197830;
      const endTick = -198080;

      const swapTokenAmount = '-99374375708776500000';
      const expectedVTokenBalance = '-99374375708776500000';

      //TODO: Check
      const expectedVQuoteBalance = 251174699412n - 2n;

      const expectedTokenAmountOut = swapTokenAmount;
      const expectedVQuoteAmountOutWithFee = 251174699412n - 2n;
      const expectedFundingPayment = 0n;

      const swapTxn = await swapTokenAndCheck(
        user1,
        user1AccountNo,
        vPool,
        vTokenAddress,
        vQuoteAddress,
        swapTokenAmount,
        0,
        false,
        false,
        startTick,
        endTick,
        expectedVTokenBalance,
        expectedVQuoteBalance,
        expectedTokenAmountOut,
        expectedVQuoteAmountOutWithFee,
        expectedFundingPayment,
      );
    });

    it('Timestamp and Oracle Update - 1500', async () => {
      await changeWrapperTimestampAndCheck(1500);
      const realSqrtPrice = await priceToSqrtPriceX96(2501.16380595116, vQuote, vToken);
      await oracle.setSqrtPriceX96(realSqrtPrice);
    });

    it('Acct[2] Long ETH : Price Changes (StartTick = -198080, EndTick = -196505)', async () => {
      const startTick = -198080;
      const endTick = -196505 - 1;

      const swapToken2Amount = '605813649564258000000';
      const expectedToken2Balance = '605813649564258000000';
      const expectedVQuoteBalance = -1641020428175n + 10n;

      // const expectedSumB = ((2494598646n*(1n<<128n))/(10n**13n))+1n;

      const expectedTokenAmountOut = swapToken2Amount;
      const expectedVQuoteAmountOutWithFee = -1641020428175n + 10n;
      const expectedFundingPayment = 0n;

      const swapTxn = await swapTokenAndCheck(
        user2,
        user2AccountNo,
        vPool,
        vTokenAddress,
        vQuoteAddress,
        swapToken2Amount,
        0,
        false,
        false,
        startTick,
        endTick,
        expectedToken2Balance,
        expectedVQuoteBalance,
        expectedTokenAmountOut,
        expectedVQuoteAmountOutWithFee,
        expectedFundingPayment,
      );
      // console.log('BTC Funding');
      // await checkTraderPositionUnrealizedFundingPayment(user1AccountNo, vToken1Address, 0n);
      // console.log('ETH Funding');
      // await checkTraderPositionUnrealizedFundingPayment(user1AccountNo, vTokenAddress, 0n);
    });

    it('Timestamp and Oracle Update - 2000', async () => {
      await changeWrapperTimestampAndCheck(2000);
      const realSqrtPrice = await priceToSqrtPriceX96(2927.79116889729, vQuote, vToken);
      await oracle.setSqrtPriceX96(realSqrtPrice);
    });

    it('Acct[1] Underwater : Liquidate ETH Token Positions @ current tickETH = -196750', async () => {
      const expectedVTokenBalance = 0n;

      const netTokenPosition = expectedVTokenBalance;

      const expectedVQuoteBalance = -52885280483n;

      const startPrice = 2926.327712;
      const endPrice = 3005.511705;

      const insuranceFundStartingBalance = await settlementToken.balanceOf(insuranceFund.address);
      const expectedInsuranceFundFee = 4428083123n;

      const liquidatorsettlementVTokenBalance = 4428083123n;

      await logPoolPrice(vPool, vToken);

      await liquidateTokenPosition(keeper, user1AccountNo, vTokenAddress);
      await logPoolPrice(vPool, vToken);

      await checkVTokenBalanceApproxiate(user1AccountNo, vTokenAddress, expectedVTokenBalance, 10);
      await checkTraderPositionApproximate(user1AccountNo, vTokenAddress, netTokenPosition, 10);

      await checkVQuoteBalance(user1AccountNo, expectedVQuoteBalance);
      await checkSettlementVTokenBalance(keeper.address, liquidatorsettlementVTokenBalance);

      await checkSettlementVTokenBalance(
        insuranceFund.address,
        insuranceFundStartingBalance.add(expectedInsuranceFundFee),
      );
    });
  });
});
