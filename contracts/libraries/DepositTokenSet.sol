//SPDX-License-Identifier: UNLICENSED

pragma solidity ^0.8.9;

import { FixedPoint128 } from '@uniswap/v3-core-0.8-support/contracts/libraries/FixedPoint128.sol';
import { SignedFullMath } from './SignedFullMath.sol';
import { Uint32L8ArrayLib } from './Uint32L8Array.sol';
import { VTokenAddress, VTokenLib } from './VTokenLib.sol';
import { RealTokenLib } from './RealTokenLib.sol';
import { VTokenPosition } from './VTokenPosition.sol';
import { AccountStorage } from '../ClearingHouseStorage.sol';

import { AccountStorage } from '../ClearingHouseStorage.sol';

import { console } from 'hardhat/console.sol';

library DepositTokenSet {
    using RealTokenLib for RealTokenLib.RealToken;
    using RealTokenLib for address;

    using Uint32L8ArrayLib for uint32[8];
    using SignedFullMath for int256;
    int256 internal constant Q96 = 0x1000000000000000000000000;

    struct Info {
        // fixed length array of truncate(tokenAddress)
        // open positions in 8 different pairs at same time.
        // single per pool because it's fungible, allows for having
        uint32[8] active;
        mapping(uint32 => uint256) deposits;
        uint256[100] emptySlots; // reserved for adding variables when upgrading logic
    }

    // add overrides that accept vToken or truncated
    function increaseBalance(
        Info storage info,
        address realTokenAddress,
        uint256 amount
    ) internal {
        uint32 truncated = realTokenAddress.truncate();

        // consider vbase as always active because it is base (actives are needed for margin check)
        info.active.include(truncated);

        info.deposits[realTokenAddress.truncate()] += amount;
    }

    function decreaseBalance(
        Info storage info,
        address realTokenAddress,
        uint256 amount
    ) internal {
        uint32 truncated = realTokenAddress.truncate();

        require(info.deposits[truncated] >= amount);
        info.deposits[truncated] -= amount;

        if (info.deposits[truncated] == 0) {
            info.active.exclude(truncated);
        }
    }

    function getAllDepositAccountMarketValue(Info storage set, AccountStorage storage accountStorage)
        internal
        view
        returns (int256)
    {
        int256 accountMarketValue;
        for (uint8 i = 0; i < set.active.length; i++) {
            uint32 truncated = set.active[i];

            if (truncated == 0) break;
            RealTokenLib.RealToken storage token = accountStorage.realTokens[truncated];

            accountMarketValue += int256(set.deposits[truncated]).mulDiv(
                token.getRealTwapPriceX128(),
                FixedPoint128.Q128
            );
        }
        return accountMarketValue;
    }
}
