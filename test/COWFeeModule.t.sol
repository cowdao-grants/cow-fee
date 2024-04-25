import { COWFeeModule, ISafe, IGPv2Settlement, GPv2Order, IERC20 } from "src/COWFeeModule.sol";
import { Test, Vm } from "forge-std/Test.sol";
import { console } from "forge-std/console.sol";

contract MockERC20 {
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => uint256) public balanceOf;

    function approve(address to, uint256 amt) external {
        allowance[msg.sender][to] = amt;
    }

    function transfer(address to, uint256 amt) external {
        balanceOf[msg.sender] -= amt;
        balanceOf[to] += amt;
    }
}

contract COWFeeModuleTest is Test {
    address keeper = makeAddr("keeper");
    COWFeeModule module;
    MockERC20 mockToken;
    address constant targetSafe = 0x423cEc87f19F0778f549846e0801ee267a917935;
    address constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    IGPv2Settlement constant settlement = IGPv2Settlement(0x9008D19f58AAbD9eD0D60971565AA8510560ab41);
    address vaultRelayer;

    function setUp() external {
        module = new COWFeeModule(address(settlement), targetSafe, WETH, keeper, bytes32(0));
        vaultRelayer = module.vaultRelayer();
        mockToken = new MockERC20();

        vm.label(address(settlement), "settlement");
        vm.label(address(vaultRelayer), "vaultRelayer");
        vm.label(targetSafe, "targetSafe");
        vm.label(address(module), "module");

        vm.prank(targetSafe);
        ISafe(targetSafe).enableModule(address(module));
    }

    function testAuth() external {
        address[] memory tokens = new address[](0);
        vm.expectRevert(COWFeeModule.OnlyKeeper.selector);
        module.approve(tokens);

        COWFeeModule.Revocation[] memory revocations = new COWFeeModule.Revocation[](0);
        vm.expectRevert(COWFeeModule.OnlyKeeper.selector);
        module.revoke(revocations);

        COWFeeModule.SwapToken[] memory swapTokens = new COWFeeModule.SwapToken[](0);
        address[] memory approveTokens = new address[](0);
        vm.expectRevert(COWFeeModule.OnlyKeeper.selector);
        module.drip(approveTokens, swapTokens);
    }

    function testApprove() external {
        uint256 currentAllowance = mockToken.allowance(address(settlement), address(vaultRelayer));
        assertEq(currentAllowance, 0, "current allowance not 0");

        address[] memory tokens = new address[](1);
        tokens[0] = address(mockToken);
        vm.prank(keeper);
        module.approve(tokens);

        uint256 newAllowance = mockToken.allowance(address(settlement), address(vaultRelayer));
        assertEq(newAllowance, type(uint256).max, "allowance not max");
    }

    function testRevoke() external {
        address[] memory tokens = new address[](1);
        tokens[0] = address(mockToken);
        vm.prank(keeper);
        module.approve(tokens);

        uint256 currentAllowance = mockToken.allowance(address(settlement), address(vaultRelayer));
        assertEq(currentAllowance, type(uint256).max, "current allowance not max");

        COWFeeModule.Revocation[] memory revocations = new COWFeeModule.Revocation[](1);
        revocations[0] = COWFeeModule.Revocation({ token: address(mockToken), spender: address(vaultRelayer) });
        vm.prank(keeper);
        module.revoke(revocations);

        uint256 newAllowance = mockToken.allowance(address(settlement), address(vaultRelayer));
        assertEq(newAllowance, 0, "allowance not 0");
    }

    event PreSignature(address indexed owner, bytes orderUid, bool signed);

    function testDrip() external {
        deal(address(mockToken), address(settlement), 100 ether);

        uint32 nextValidTo = module.nextValidTo();
        bytes32 orderHash = GPv2Order.hash(
            GPv2Order.Data({
                sellToken: IERC20(address(mockToken)),
                buyToken: IERC20(WETH),
                receiver: targetSafe,
                sellAmount: 100 ether,
                buyAmount: 1,
                validTo: nextValidTo,
                appData: bytes32(0),
                feeAmount: 0,
                kind: GPv2Order.KIND_SELL,
                partiallyFillable: true,
                sellTokenBalance: GPv2Order.BALANCE_ERC20,
                buyTokenBalance: GPv2Order.BALANCE_ERC20
            }),
            settlement.domainSeparator()
        );
        bytes memory preSignature = abi.encodePacked(orderHash, address(settlement), nextValidTo);

        COWFeeModule.SwapToken[] memory swapTokens = new COWFeeModule.SwapToken[](1);
        swapTokens[0] = COWFeeModule.SwapToken({ token: address(mockToken), buyAmount: 1, sellAmount: 100 ether });

        address[] memory approveTokens = new address[](1);
        approveTokens[0] = address(mockToken);
        uint256 previousAllowance = mockToken.allowance(address(settlement), vaultRelayer);
        assertEq(previousAllowance, 0, "previousAllowance not 0");

        vm.recordLogs();
        vm.prank(keeper);
        module.drip(approveTokens, swapTokens);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        bool found = false;
        address owner;
        bytes memory orderUid;
        bool signed;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics.length > 0 && logs[i].topics[0] == PreSignature.selector) {
                owner = address(uint160(uint256(logs[i].topics[1])));
                (orderUid, signed) = abi.decode(logs[i].data, (bytes, bool));
                found = true;
                break;
            }
        }
        uint256 postDripAllowance = mockToken.allowance(address(settlement), vaultRelayer);
        assertEq(postDripAllowance, type(uint256).max, "postDripAllowance not uint.max");
        assertTrue(found, "PreSignature not found");

        assertEq(owner, address(settlement), "owner not settlement");
        assertEq(signed, true, "not signed");
        assertEq(orderUid, preSignature, "orderUid not correct");
    }
}
