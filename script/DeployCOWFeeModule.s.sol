pragma solidity 0.8.25;

import {Script} from "forge-std/Script.sol";
import {COWFeeModule, ISafe} from "src/COWFeeModule.sol";

contract DeployCOWFeeModule is Script {
    function run() external {
        address receiver = vm.envAddress("RECEIVER");
        address toToken = vm.envAddress("TO_TOKEN");
        address keeper = vm.envAddress("KEEPER");
        address settlement = vm.envAddress("SETTLEMENT");
        bytes32 appData = vm.envBytes32("APP_DATA");
        bool shouldEnableModule = vm.envOr("SHOULD_ENABLE_MODULE", false);
        address targetSafe = vm.envAddress("TARGET_SAFE");
        uint256 minOut = vm.envUint("MIN_OUT");

        vm.broadcast();
        COWFeeModule module = new COWFeeModule(settlement, targetSafe, toToken, keeper, appData, receiver, minOut);

        // only useful for local anvil setup
        if (shouldEnableModule) {
            vm.broadcast(receiver);
            ISafe(receiver).enableModule(address(module));
        }
    }
}
