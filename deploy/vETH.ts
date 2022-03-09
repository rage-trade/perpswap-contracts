import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import { IUniswapV3Pool__factory, VPoolWrapper__factory, VToken__factory } from '../typechain-types';

import { getNetworkInfo } from './network-info';
import { AggregatorV3Interface__factory } from '../typechain-types';

import {
  PoolInitializedEvent,
  VTokenDeployer,
  RageTradeFactory,
  IClearingHouseStructures,
} from '../typechain-types/RageTradeFactory';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const {
    deployments: { get, deploy, execute, save },
    getNamedAccounts,
  } = hre;

  let alreadyDeployed = false;

  try {
    await get('ETH-vToken');
    alreadyDeployed = true;
  } catch (e) {
    console.log((e as Error).message);
  }

  if (!alreadyDeployed) {
    const { deployer } = await getNamedAccounts();

    let ethIndexOracleDeployment;
    const oracleAddress = getNetworkInfo(hre.network.config.chainId).ETH_USD_ORACLE;

    if (oracleAddress) {
      ethIndexOracleDeployment = await deploy('ETH-IndexOracle', {
        contract: 'ChainlinkOracle',
        args: [oracleAddress, 18, 6],
        from: deployer,
        log: true,
      });
    } else {
      ethIndexOracleDeployment = await deploy('ETH-IndexOracle', {
        contract: 'OracleMock',
        from: deployer,
        log: true,
      });
    }

    const deployVTokenParams: VTokenDeployer.DeployVTokenParamsStruct = {
      vTokenName: 'Virtual ETH (Rage Trade)',
      vTokenSymbol: 'vETH',
      cTokenDecimals: 18,
    };

    const poolInitialSettings: IClearingHouseStructures.PoolSettingsStruct = {
      initialMarginRatio: 20000,
      maintainanceMarginRatio: 10000,
      twapDuration: 300,
      isAllowedForTrade: true,
      isCrossMargined: true,
      oracle: ethIndexOracleDeployment.address,
    };

    const params: RageTradeFactory.InitializePoolParamsStruct = {
      deployVTokenParams,
      poolInitialSettings,
      liquidityFeePips: 1000,
      protocolFeePips: 500,
      slotsToInitialize: 10,
    };

    const tx = await execute('RageTradeFactory', { from: deployer }, 'initializePool', params);

    const poolInitializedLog = tx.events?.find(
      event => event?.event === 'PoolInitialized',
    ) as unknown as PoolInitializedEvent;
    if (!poolInitializedLog) {
      throw new Error('PoolInitialized log not found');
    }

    await save('ETH-vToken', { abi: VToken__factory.abi, address: poolInitializedLog.args.vToken });
    console.log('saved "ETH-vToken":', poolInitializedLog.args.vToken);
    await hre.tenderly.push({
      name: 'VToken',
      address: poolInitializedLog.args.vToken,
    });

    await save('ETH-vPool', {
      abi: IUniswapV3Pool__factory.abi,
      address: poolInitializedLog.args.vPool,
    });
    console.log('saved "ETH-vPool":', poolInitializedLog.args.vPool);
    await hre.tenderly.push({
      name: 'IUniswapV3Pool',
      address: poolInitializedLog.args.vPool,
    });

    await save('ETH-vPoolWrapper', { abi: VPoolWrapper__factory.abi, address: poolInitializedLog.args.vPoolWrapper });
    console.log('saved "ETH-vPoolWrapper":', poolInitializedLog.args.vPoolWrapper);
    await hre.tenderly.push({
      name: 'TransparentUpgradeableProxy',
      address: poolInitializedLog.args.vPoolWrapper,
    });
  }
};

export default func;

func.tags = ['vETH'];
