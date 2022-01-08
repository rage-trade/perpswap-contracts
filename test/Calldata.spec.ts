import { expect } from 'chai';
import hre from 'hardhat';

import { CalldataTest } from '../typechain-types';

describe('Calldata', () => {
  let test: CalldataTest;
  beforeEach(async () => {
    test = await (await hre.ethers.getContractFactory('CalldataTest')).deploy();
  });

  describe('#calculateCostUnits', () => {
    const cases: Array<{ data: string; result: number }> = [
      { data: '0x', result: 0 },
      { data: '0x12', result: 16 },
      { data: '0x00', result: 4 },
      {
        // https://rinkeby.etherscan.io/tx/0xb9e89d521b6c0d0fcae4ce2bf4ff69d47d9bacd8a8e6705cc5b9e8efd4e388b8
        data: '0xa9059cbb0000000000000000000000004240781a9ebdb2eb14a183466e8820978b7da4e20000000000000000000000000000000000000000000000000000000032116200',
        result: 596,
      },
      {
        // https://rinkeby.etherscan.io/tx/0xc2cee56b8e836c20c84587b86c624f42aad9cb89004dea28af5fcad53e6a3b2f
        data: '0x5ae401dc0000000000000000000000000000000000000000000000000000000061d9a16600000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000e4472b43f300000000000000000000000000000000000000000000000006f05b59d3b200000000000000000000000000000000000000000000000001253f168c52273298ec000000000000000000000000000000000000000000000000000000000000008000000000000000000000000050eac660bd5d3f55196214115db7026e1cc3a0f30000000000000000000000000000000000000000000000000000000000000002000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000000000000000000000000b12494c8824fc069757f47d177e666c571cd49ae00000000000000000000000000000000000000000000000000000000',
        result: 2808,
      },
      {
        // https://rinkeby.etherscan.io/tx/0xde2afc51a6a8d11942ed01518acb023b71960d8a94c4bb7a030dd1112c8c4bf3
        data: '0xab834bab0000000000000000000000007be8076f4ea4a4ad08075c2508e481d6c946d12b0000000000000000000000005f3f6d5c3b14d98484739717f7182a2f701709f90000000000000000000000009d6cb1214a76e00252949c1972f02fc43bd7f1670000000000000000000000000000000000000000000000000000000000000000000000000000000000000000c36cf0cfcb5d905b8b513860db0cfe63f6cf9f5c000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000007be8076f4ea4a4ad08075c2508e481d6c946d12b0000000000000000000000009d6cb1214a76e00252949c1972f02fc43bd7f16700000000000000000000000000000000000000000000000000000000000000000000000000000000000000005b3256965e7c3cf26e11fcaf296dfc8807c01073000000000000000000000000c36cf0cfcb5d905b8b513860db0cfe63f6cf9f5c0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001f40000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000022d10c4ecc800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000061d9991b00000000000000000000000000000000000000000000000000000000000000003ad32cf5f52d8dc40d5e733066dbcdb4d6880b9a2260bbe08fea20b4019bca8a00000000000000000000000000000000000000000000000000000000000001f40000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000022d10c4ecc800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000061c818100000000000000000000000000000000000000000000000000000000062b80969673e358c32998a2b87c6d596e0e4629382e903c47fdf490c3676410e310ed4940000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006a000000000000000000000000000000000000000000000000000000000000007a000000000000000000000000000000000000000000000000000000000000008a000000000000000000000000000000000000000000000000000000000000009a00000000000000000000000000000000000000000000000000000000000000aa00000000000000000000000000000000000000000000000000000000000000ac0000000000000000000000000000000000000000000000000000000000000001c000000000000000000000000000000000000000000000000000000000000001cd4316816e4e7d86c562e00749f973d2172d66087acdd5456bf1b15e3b9dc7c55449a0d7e53a4050c36e69daf87084163c8340115a588ce079815312f236bacacd4316816e4e7d86c562e00749f973d2172d66087acdd5456bf1b15e3b9dc7c55449a0d7e53a4050c36e69daf87084163c8340115a588ce079815312f236bacac000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000c4f242432a00000000000000000000000000000000000000000000000000000000000000000000000000000000000000005f3f6d5c3b14d98484739717f7182a2f701709f90000000000000000000000000000017300000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000c4f242432a0000000000000000000000009d6cb1214a76e00252949c1972f02fc43bd7f16700000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000017300000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000c400000000ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000c4000000000000000000000000000000000000000000000000000000000000000000000000ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
        result: 17428,
      },
    ];

    for (const { data, result } of cases) {
      it(`calculateCostUnits(${data}) == ${result}`, async () => {
        expect(await test.calculateCostUnits(data)).to.eq(result);
      });
    }
  });
});
