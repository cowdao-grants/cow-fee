import { Script } from "forge-std/Script.sol";
import { COWFeeModule, ISafe } from "src/COWFeeModule.sol";

contract COWFeeModuleDeployScript is Script {
    function run() external {
        address targetSafe = 0x423cEc87f19F0778f549846e0801ee267a917935;
        address WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
        address keeper = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266;

        bytes32 appData = 0xf3ccd10db03031ba3b5fa16bbd60cc86a9701a1be4928578f4fa24870b7f3515;
        vm.broadcast();
        COWFeeModule module = new COWFeeModule(targetSafe, WETH, keeper, appData);
        vm.broadcast(targetSafe);
        ISafe(targetSafe).enableModule(address(module));
    }
}
