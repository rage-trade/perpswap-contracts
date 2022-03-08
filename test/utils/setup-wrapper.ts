import hre from 'hardhat';
import { smock } from '@defi-wonderland/smock';
import { BigNumberish } from 'ethers';
import { ClearingHouse, VPoolWrapperMock2__factory } from '../../typechain-types';
import { setupVPool, SetupArgs } from './setup-vPool';
import { toQ128 } from './fixed-point';

export async function setupWrapper(setupArgs: SetupArgs) {
  const signer = setupArgs.signer ?? (await hre.ethers.getSigners())[0];
  const { vPool, vBase, vToken, oracle } = await setupVPool(setupArgs);

  const clearingHouse = await smock.fake<ClearingHouse>('ClearingHouse', {
    address: signer.address,
  });

  await setTwapSqrtPricesForSetDuration({
    realPriceX128: toQ128(setupArgs.rPriceInitial ?? 1),
    virtualPriceX128: toQ128(setupArgs.vPriceInitial ?? 1),
  });

  const vPoolWrapper = await (await smock.mock<VPoolWrapperMock2__factory>('VPoolWrapperMock2')).deploy();
  await vPoolWrapper.__initialize_VPoolWrapper({
    clearingHouse: signer.address,
    vToken: vToken.address,
    vBase: vBase.address,
    vPool: vPool.address,
    liquidityFeePips: setupArgs.liquidityFee ?? 1000,
    protocolFeePips: setupArgs.protocolFee ?? 500,
    UNISWAP_V3_DEFAULT_FEE_TIER: 500,
  });
  // await vPoolWrapper.setOracle(oracle.address);
  hre.tracer.nameTags[vPoolWrapper.address] = 'vPoolWrapper';

  await vBase.setVariable('isAuth', { [vPoolWrapper.address]: true });
  await vToken.setVariable('vPoolWrapper', vPoolWrapper.address);

  return { vPoolWrapper, vPool, vBase, vToken, oracle };

  async function setTwapSqrtPricesForSetDuration({
    realPriceX128,
    virtualPriceX128,
  }: {
    realPriceX128: BigNumberish;
    virtualPriceX128: BigNumberish;
  }) {
    clearingHouse.getTwapPrices.returns([realPriceX128, virtualPriceX128]);
  }
}
