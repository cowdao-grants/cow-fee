import {
    COWFeeModule,
    ISafe,
    settlement,
    vaultRelayer,
    IGPv2Settlement,
    ERC20_BALANCE_HASH,
    SELL_KIND_HASH,
    ORDER_TYPE_HASH
} from "src/COWFeeModule.sol";
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
    address targetSafe = 0x423cEc87f19F0778f549846e0801ee267a917935;
    address WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;

    function setUp() external {
        module = new COWFeeModule(targetSafe, WETH, keeper, bytes32(0));
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
        vm.expectRevert(COWFeeModule.OnlyKeeper.selector);
        module.drip(swapTokens);
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
        bytes32 orderHash = _computeOrderHash(
            IGPv2Settlement.OrderData({
                sellToken: address(mockToken),
                buyToken: WETH,
                receiver: targetSafe,
                sellAmount: 100 ether,
                buyAmount: 1,
                validTo: nextValidTo,
                appData: bytes32(0),
                feeAmount: 0,
                kind: SELL_KIND_HASH,
                partiallyFillable: true,
                sellTokenBalance: ERC20_BALANCE_HASH,
                buyTokenBalance: ERC20_BALANCE_HASH
            })
        );
        bytes memory preSignature = abi.encodePacked(orderHash, address(settlement), nextValidTo);

        COWFeeModule.SwapToken[] memory swapTokens = new COWFeeModule.SwapToken[](1);
        swapTokens[0] = COWFeeModule.SwapToken({ token: address(mockToken), sellAmount: 100 ether });

        vm.recordLogs();
        vm.prank(keeper);
        module.drip(swapTokens);
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

        assertTrue(found, "PreSignature not found");

        assertEq(owner, address(settlement), "owner not settlement");
        assertEq(signed, true, "not signed");
        assertEq(orderUid, preSignature, "orderUid not correct");
    }

    function _computeOrderHash(IGPv2Settlement.OrderData memory order) internal view returns (bytes32 orderDigest) {
        bytes32 structHash;

        // NOTE: Compute the EIP-712 order struct hash in place. As suggested
        // in the EIP proposal, noting that the order struct has 10 fields, and
        // including the type hash `(12 + 1) * 32 = 416` bytes to hash.
        // <https://github.com/ethereum/EIPs/blob/master/EIPS/eip-712.md#rationale-for-encodedata>
        // solhint-disable-next-line no-inline-assembly
        assembly {
            let dataStart := sub(order, 32)
            let temp := mload(dataStart)
            mstore(dataStart, ORDER_TYPE_HASH)
            structHash := keccak256(dataStart, 416)
            mstore(dataStart, temp)
        }

        bytes32 domainSeparator_ = settlement.domainSeparator();
        // NOTE: Now that we have the struct hash, compute the EIP-712 signing
        // hash using scratch memory past the free memory pointer. The signing
        // hash is computed from `"\x19\x01" || domainSeparator || structHash`.
        // <https://docs.soliditylang.org/en/v0.7.6/internals/layout_in_memory.html#layout-in-memory>
        // <https://github.com/ethereum/EIPs/blob/master/EIPS/eip-712.md#specification>
        // solhint-disable-next-line no-inline-assembly
        assembly {
            let freeMemoryPointer := mload(0x40)
            mstore(freeMemoryPointer, "\x19\x01")
            mstore(add(freeMemoryPointer, 2), domainSeparator_)
            mstore(add(freeMemoryPointer, 34), structHash)
            orderDigest := keccak256(freeMemoryPointer, 66)
        }
    }
}
