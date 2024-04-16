import { Script } from "forge-std/Script.sol";
import { CoWFeeModule, ISafe } from "src/CoWFeeModule.sol";

contract CoWFeeModuleDeployScript is Script {
    function run() external {
        address targetSafe = 0x423cEc87f19F0778f549846e0801ee267a917935;
        address WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
        address keeper = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266;

        bytes32 appData = 0xbcca8463f460f14bca0185afeeb75923ee4434612f41063d0171b1e743ffe84b;
        vm.broadcast();
        CoWFeeModule module = new CoWFeeModule(targetSafe, WETH, keeper, appData);
        vm.broadcast(targetSafe);
        ISafe(targetSafe).enableModule(address(module));
    }
}
