//SPDX-License-Identifier: UNLICENSED

pragma solidity ^0.8.9;
import { TickUtilLib } from './TickUtilLib.sol';
import { VTokenLib, VTokenAddress } from './VTokenLib.sol';
import { Constants } from '../Constants.sol';

library GlobalUtilLib {
    using GlobalUtilLib for GlobalState;
    using VTokenLib for VTokenAddress;
    int256 constant fundingRateNormalizer = 10000 * 100 * 3600;
    uint256 constant amountNormalizer = 10**18;

    struct GlobalState {
        int256 sumB;
        int256 sumFP;
        uint48 lastTradeTS;
        int256 sumA;
        int16 fundingRate; // (funding rate/hr in %) * 10000
        VTokenAddress vToken;
        uint256 feeGrowthGlobalShortsX128; // see if Binary Fixed point is needed or not
    }

    function getExtrapolatedSumA(
        GlobalState storage global,
        uint48 blockTimestamp,
        Constants memory constants
    ) internal view returns (int256) {
        // uint48 blockTimestamp = uint48(block.timestamp);
        uint48 diffTS = blockTimestamp - global.lastTradeTS;
        return
            global.sumA +
            (global.fundingRate * int256(uint256(global.vToken.getVirtualTwapPriceX128(constants) * (diffTS)))) /
            fundingRateNormalizer;
    }

    function getExtrapolatedSumFP(
        GlobalState storage global,
        TickUtilLib.TickState memory state,
        uint48 blockTimestamp,
        Constants memory constants
    ) internal view returns (int256) {
        return
            getExtrapolatedSumFP(global, state.sumA, state.sumBOutside, state.sumFPOutside, blockTimestamp, constants);
    }

    function getExtrapolatedSumFP(
        GlobalState storage global,
        int256 sumACkpt,
        int256 sumBCkpt,
        int256 sumFPCkpt,
        uint48 blockTimestamp,
        Constants memory constants
    ) internal view returns (int256) {
        return sumFPCkpt + sumBCkpt * (global.getExtrapolatedSumA(blockTimestamp, constants) - sumACkpt);
    }

    function calculateFundingRate(GlobalState storage global, Constants memory constants)
        internal
        view
        returns (int16)
    {
        int256 realPrice = int256(global.vToken.getRealTwapPriceX128(constants));
        int256 virtualPrice = int256(global.vToken.getVirtualTwapPriceX128(constants));

        return int16(((virtualPrice - realPrice) * (10**6)) / realPrice);
    }

    function updateOnTrade(
        GlobalState storage global,
        int256 tokenAmount,
        uint256 fees,
        uint256 liquidity,
        uint48 blockTimestamp,
        Constants memory constants
    ) internal {
        //sumFP should be updated before updating sumB and lastTradeTS

        //TODO: block.timestamp is uint256 check
        // uint48 blockTimestamp = uint48(block.timestamp);
        uint48 diffTS = blockTimestamp - global.lastTradeTS;

        //TODO: check if the conversion needs to be removed
        global.lastTradeTS = blockTimestamp;

        //TODO: Use vToken
        int256 a = int256(uint256(global.vToken.getVirtualTwapPriceX128(constants))) * int48(diffTS); //vToken.getVirtualTwapPrice(diffTS) * (diffTS) ;
        global.sumFP = global.sumFP + (global.fundingRate * a * global.sumB) / fundingRateNormalizer;
        global.sumA = global.sumA + a;
        global.sumB = global.sumB + (tokenAmount * int256(amountNormalizer)) / int256(liquidity);

        global.feeGrowthGlobalShortsX128 += (fees * amountNormalizer) / liquidity;
    }

    function getPricePosition(
        int24 curPriceIndex,
        int24 tickLowerIndex,
        int24 tickHigherIndex
    ) internal pure returns (uint8) {
        if (curPriceIndex < tickLowerIndex) return uint8(0);
        else if (curPriceIndex < tickHigherIndex) return uint8(1);
        else return uint8(2);
    }

    // function getSumBInside(GlobalState storage global, TickUtilLib.TickState storage tickLower, TickUtilLib.TickState storage tickHigher, uint8 pricePosition) internal view
    // returns (int256){
    //     if(pricePosition==0){
    //         return tickLower.sumBOutside - tickHigher.sumBOutside;
    //     } else if( pricePosition==1){
    //         return global.sumB - tickHigher.sumBOutside - tickLower.sumBOutside;
    //     } else {
    //         return tickHigher.sumBOutside - tickLower.sumBOutside;
    //     }
    // }

    // function getSumFPInside(GlobalState storage global, TickUtilLib.TickState storage tickLower, TickUtilLib.TickState storage tickHigher, uint8 pricePosition) internal view
    // returns (int256){
    //     if(pricePosition==0){
    //         return global.getExtrapolatedSumFP(tickLower.sumA,tickLower.sumBOutside,tickLower.sumFPOutside,blockTimestamp) - global.getExtrapolatedSumFP(tickHigher.sumA,tickHigher.sumBOutside,tickHigher.sumFPOutside,blockTimestamp);
    //     } else if( pricePosition==1){
    //         return global.sumFP - global.getExtrapolatedSumFP(tickLower.sumA,tickLower.sumBOutside,tickLower.sumFPOutside,blockTimestamp) - global.getExtrapolatedSumFP(tickHigher.sumA,tickHigher.sumBOutside,tickHigher.sumFPOutside,blockTimestamp);
    //     } else {
    //         return global.getExtrapolatedSumFP(tickHigher.sumA,tickHigher.sumBOutside,tickHigher.sumFPOutside,blockTimestamp) - global.getExtrapolatedSumFP(tickLower.sumA,tickLower.sumBOutside,tickLower.sumFPOutside,blockTimestamp);
    //     }
    // }

    // function getFeesShortsInside(GlobalState storage global, TickUtilLib.TickState storage tickLower, TickUtilLib.TickState storage tickHigher, uint8 pricePosition) internal view
    // returns (uint256){
    //     if(pricePosition==0){
    //         return tickLower.feeGrowthOutsideShortsX128 - tickHigher.feeGrowthOutsideShortsX128;
    //     } else if( pricePosition==1){
    //         return global.feeGrowthGlobalShortsX128 - tickLower.feeGrowthOutsideShortsX128 - tickHigher.feeGrowthOutsideShortsX128;
    //     } else {
    //         return tickHigher.feeGrowthOutsideShortsX128 - tickLower.feeGrowthOutsideShortsX128;
    //     }
    // }

    function getUpdatedLPStateInternal(
        GlobalState storage global,
        TickUtilLib.TickLowerHigher storage tickLowerHigher,
        uint8 pricePosition,
        uint48 blockTimestamp,
        Constants memory constants
    )
        internal
        view
        returns (
            int256,
            int256,
            int256,
            uint256
        )
    {
        if (pricePosition == 0) {
            return (
                global.getExtrapolatedSumA(blockTimestamp, constants),
                tickLowerHigher.tickLower.sumBOutside - tickLowerHigher.tickHigher.sumBOutside,
                global.getExtrapolatedSumFP(tickLowerHigher.tickLower, blockTimestamp, constants) -
                    global.getExtrapolatedSumFP(tickLowerHigher.tickHigher, blockTimestamp, constants),
                tickLowerHigher.tickLower.feeGrowthOutsideShortsX128 -
                    tickLowerHigher.tickHigher.feeGrowthOutsideShortsX128
            );
        } else if (pricePosition == 1) {
            return (
                global.getExtrapolatedSumA(blockTimestamp, constants),
                global.sumB - tickLowerHigher.tickHigher.sumBOutside - tickLowerHigher.tickLower.sumBOutside,
                global.sumFP -
                    global.getExtrapolatedSumFP(tickLowerHigher.tickLower, blockTimestamp, constants) -
                    global.getExtrapolatedSumFP(tickLowerHigher.tickHigher, blockTimestamp, constants),
                global.feeGrowthGlobalShortsX128 -
                    tickLowerHigher.tickLower.feeGrowthOutsideShortsX128 -
                    tickLowerHigher.tickHigher.feeGrowthOutsideShortsX128
            );
        } else {
            return (
                global.getExtrapolatedSumA(blockTimestamp, constants),
                tickLowerHigher.tickHigher.sumBOutside - tickLowerHigher.tickLower.sumBOutside,
                global.getExtrapolatedSumFP(tickLowerHigher.tickHigher, blockTimestamp, constants) -
                    global.getExtrapolatedSumFP(tickLowerHigher.tickLower, blockTimestamp, constants),
                tickLowerHigher.tickHigher.feeGrowthOutsideShortsX128 -
                    tickLowerHigher.tickLower.feeGrowthOutsideShortsX128
            );
        }
    }

    //SumFP Ckpt removed because of stack too deep. Can be added outside.
    function getUpdatedLPState(
        GlobalState storage global,
        TickUtilLib.TickLowerHigher storage tickLowerHigher,
        int24 tickLowerIndex,
        int24 tickHigherIndex,
        uint48 blockTimestamp,
        Constants memory constants
    )
        internal
        view
        returns (
            int256,
            int256,
            int256,
            uint256
        )
    {
        //TODO: Correct current price code
        int24 curPriceIndex = global.vToken.getVirtualTwapTick(constants);
        // uint8 pricePosition = ;
        return
            global.getUpdatedLPStateInternal(
                tickLowerHigher,
                getPricePosition(curPriceIndex, tickLowerIndex, tickHigherIndex),
                blockTimestamp,
                constants
            );
    }
}
