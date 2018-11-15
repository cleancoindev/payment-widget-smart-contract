const BigNumber = web3.BigNumber
const Helper = require("./helper.js");
//const { ZEPPELIN_LOCATION } = require("../helper.js");
//const { expectThrow } = require(ZEPPELIN_LOCATION + 'openzeppelin-solidity/test/helpers/expectThrow');

require("chai")
    .use(require("chai-as-promised"))
    .use(require('chai-bignumber')(BigNumber))
    .should()

const precision = (new BigNumber(10).pow(18));
const ethAddress = '0x00eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const ethAddressJS = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const paymentData = "ThisIsPaymentData"
const paymentDataHex = "0x".concat(new Buffer(paymentData).toString('hex'));
const rate = 0.25

const KyberPayWrapper = artifacts.require("./KyberPayWrapper.sol")
const TestToken = artifacts.require("./mock/TestToken.sol");
const MockKyberNetwork = artifacts.require("./mock/MockKyberNetwork.sol");

async function getBalances(currency ,senderAddress, recieverAddress) {
    if( currency == ethAddress) {
        senderBalance = await Helper.getBalancePromise(senderAddress);
        recieverBalance = await Helper.getBalancePromise(recieverAddress);
    } else {
        senderBalance = await currency.balanceOf(senderAddress);
        recieverBalance = await currency.balanceOf(recieverAddress);
    }
    return [senderBalance, recieverBalance]
}

async function getGasCost(txInfo) {
    tx = await web3.eth.getTransaction(txInfo.tx);
    return tx.gasPrice.mul(txInfo.receipt.gasUsed); 
}

contract('KyberPayWrapper', function(accounts) {

    const admin = accounts[0];
    const reciever = accounts[1];
    const other = accounts[2];

    beforeEach('create contracts', async function () {
        payWrapper = await KyberPayWrapper.new();

        token1 = await TestToken.new("token1", "tok1", 18);
        token2 = await TestToken.new("token2", "tok2", 18);
        kyberNetwork = await MockKyberNetwork.new();

        // move some tokens and ether to kyber network
        const kyberNetworkTok1InitAmount = precision.times(100)
        await token1.transfer(kyberNetwork.address, kyberNetworkTok1InitAmount)

        senderEthBefore = await Helper.getBalancePromise(admin);
        senderTok1Before = await token1.balanceOf(admin);
        senderTok2Before = await token2.balanceOf(admin);

        recieverEthBefore = await Helper.getBalancePromise(reciever);
        recieverTok1Before = await token1.balanceOf(reciever);
        recieverTok2Before = await token2.balanceOf(reciever);
    });

    describe('eth to eth', function () {
        const amount = precision.mul(7)

        it("max dest amount is exactly src amount", async function () {
            txInfo = await payWrapper.pay(ethAddress, amount, ethAddress, reciever, amount, 0, 0, paymentData,
                                          0, kyberNetwork.address, {value: amount})

            let senderEthAfter, recieverEthAfter;
            expectedSenderLoss = amount.plus(await getGasCost(txInfo));
            [senderEthAfter, recieverEthAfter] =  await getBalances(ethAddress, admin, reciever);

            assert.equal(senderEthAfter.toString(), senderEthBefore.minus(expectedSenderLoss).toString())
            assert.equal(recieverEthAfter.toString(), recieverEthBefore.plus(amount).toString())
        });

        it("event is emitted correctly", async function () {
            const { logs } = await payWrapper.pay(ethAddress, amount, ethAddress, reciever, amount, 0, 0, paymentData,
                                                  0, kyberNetwork.address, {value: amount})

            assert.equal(logs.length, 1);
            assert.equal(logs[0].event, 'ProofOfPayment');
            assert.equal(logs[0].args._beneficiary, reciever);
            assert.equal(logs[0].args._token, ethAddressJS);
            assert.equal(logs[0].args._amount, amount.toString());
            assert.equal(logs[0].args._data, paymentDataHex);
        });

        it("max dest amount is smaller than src amount", async function () {
            const maxDstAmount = amount.times(0.8)
            txInfo = await payWrapper.pay(ethAddress, amount, ethAddress, reciever, maxDstAmount, 0, 0, paymentData,
                                          0, kyberNetwork.address, {value: amount})

            let senderEthAfter, recieverEthAfter;
            expectedSenderLoss = maxDstAmount.plus(await getGasCost(txInfo));
            [senderEthAfter, recieverEthAfter] =  await getBalances(ethAddress, admin, reciever);
            
            assert.equal(senderEthAfter.toString(), senderEthBefore.minus(expectedSenderLoss).toString())
            assert.equal(recieverEthAfter.toString(), recieverEthBefore.plus(maxDstAmount).toString())
        });

        it("max dest amount is larger than src amount", async function () {
            const maxDstAmount = amount.times(1.1)
            txInfo = await payWrapper.pay(ethAddress, amount, ethAddress, reciever, maxDstAmount, 0, 0, paymentData,
                                          0, kyberNetwork.address, {value: amount})

            let senderEthAfter, recieverEthAfter;
            expectedSenderLoss = amount.plus(await getGasCost(txInfo));
            [senderEthAfter, recieverEthAfter] =  await getBalances(ethAddress, admin, reciever);

            assert.equal(senderEthAfter.toString(), senderEthBefore.minus(expectedSenderLoss).toString())
            assert.equal(recieverEthAfter.toString(), recieverEthBefore.plus(amount).toString())
        });

        it("without sending enough eth", async function () {
            const amountToSend = amount.times(0.5)

            try {
                await payWrapper.pay(ethAddress, amount, ethAddress, reciever, amount, 0, 0, paymentData,
                                     0, kyberNetwork.address, {value: amountToSend})
            } catch(e){
                assert(Helper.isRevertErrorMessage(e), "expected throw but got: " + e);
            }
        });
    });

    describe('token to same token', function () {
        const amount = precision.mul(5);

        it("max dest amount is exactly src amount", async function () {
            await token1.approve(payWrapper.address, amount)
            await payWrapper.pay(token1.address, amount, token1.address, reciever, amount, 0, 0, paymentData,
                                 0, kyberNetwork.address)

            expectedSenderLoss = amount
            senderTokensAfter = await token1.balanceOf(admin);
            recieverTokensAfter = await token1.balanceOf(reciever);

            assert.equal(senderTokensAfter.toString(), senderTok1Before.minus(expectedSenderLoss).toString())
            assert.equal(recieverTokensAfter.toString(), recieverTok1Before.plus(amount).toString())
        });

        it("event is emitted correctly", async function () {
            await token1.approve(payWrapper.address, amount)
            const { logs } = await payWrapper.pay(token1.address, amount, token1.address, reciever, amount, 0, 0, paymentData,
                                                  0, kyberNetwork.address)

            assert.equal(logs.length, 1);
            assert.equal(logs[0].event, 'ProofOfPayment');
            assert.equal(logs[0].args._beneficiary, reciever);
            assert.equal(logs[0].args._token, token1.address);
            assert.equal(logs[0].args._amount, amount.toString());
            assert.equal(logs[0].args._data, paymentDataHex);
        });

        it("max dest amount is smaller than src amount", async function () {
            const maxDstAmount = amount.times(0.8)
            await token1.approve(payWrapper.address, amount)
            await payWrapper.pay(token1.address, amount, token1.address, reciever, maxDstAmount, 0, 0, paymentData,
                                 0, kyberNetwork.address)

            expectedSenderLoss = maxDstAmount;
            senderTokensAfter = await token1.balanceOf(admin);
            recieverTokensAfter = await token1.balanceOf(reciever);

            assert.equal(senderTokensAfter.toString(), senderTok1Before.minus(expectedSenderLoss).toString())
            assert.equal(recieverTokensAfter.toString(), recieverTok1Before.plus(maxDstAmount).toString())
        });

        it("max dest amount is larger than src amount", async function () {
            const maxDstAmount = amount.times(2.1)
            await token1.approve(payWrapper.address, amount)
            await payWrapper.pay(token1.address, amount, token1.address, reciever, maxDstAmount, 0, 0, paymentData,
                                 0, kyberNetwork.address)

            expectedSenderLoss = amount;
            senderTokensAfter = await token1.balanceOf(admin);
            recieverTokensAfter = await token1.balanceOf(reciever);

            assert.equal(senderTokensAfter.toString(), senderTok1Before.minus(expectedSenderLoss).toString())
            assert.equal(recieverTokensAfter.toString(), recieverTok1Before.plus(amount).toString())
        });

        it("verify allowance of pay wrapper is 0 after the payment", async function () {
            await token1.approve(payWrapper.address, amount)
            await payWrapper.pay(token1.address, amount, token1.address, reciever, amount, 0, 0, paymentData,
                                 0, kyberNetwork.address)
            const allowance = await token1.allowance(payWrapper.address, kyberNetwork.address);
            assert.equal(allowance, 0)
        });
    });

    describe('eth to token', function () {
        const amount = precision.mul(1.8);

        it("max dest amount is exactly as expected dest amount", async function () {
            const maxDestAmount = amount.times(1/rate);
            txInfo = await payWrapper.pay(ethAddress, amount, token1.address, reciever, maxDestAmount, 0, 0, paymentData,
                                          0, kyberNetwork.address, {value: amount})

            expectedSenderLoss = amount.plus(await getGasCost(txInfo));
            expectedRecierverGain = amount.times(1/rate);

            senderEthAfter = await Helper.getBalancePromise(admin);
            recieverTokensAfter = await token1.balanceOf(reciever);

            assert.equal(senderEthAfter.toString(), senderEthBefore.minus(expectedSenderLoss).toString())
            assert.equal(recieverTokensAfter.toString(), recieverTok1Before.plus(expectedRecierverGain).toString())
        });

        it("event is emitted correctly", async function () {
            const maxDestAmount = amount.times(1/rate);
            const { logs } = await payWrapper.pay(ethAddress, amount, token1.address, reciever, maxDestAmount, 0, 0, paymentData,
                                                  0, kyberNetwork.address, {value: amount})

            assert.equal(logs.length, 1);
            assert.equal(logs[0].event, 'ProofOfPayment');
            assert.equal(logs[0].args._beneficiary, reciever);
            assert.equal(logs[0].args._token, token1.address);
            assert.equal(logs[0].args._amount, maxDestAmount.toString());
            assert.equal(logs[0].args._data, paymentDataHex);
        });

        it("max dest amount is smaller than expected dest amount", async function () {
            const maxDestAmount = amount.times(1/rate).times(0.7);
            txInfo = await payWrapper.pay(ethAddress, amount, token1.address, reciever, maxDestAmount, 0, 0, paymentData,
                                 0, kyberNetwork.address, {value: amount})

            const expectedActualSrcAmount = amount.times(0.7);
            expectedSenderLoss = expectedActualSrcAmount.plus(await getGasCost(txInfo));
            expectedRecierverGain = maxDestAmount;

            senderEthAfter = await Helper.getBalancePromise(admin);
            recieverTokensAfter = await token1.balanceOf(reciever);

            assert.equal(senderEthAfter.toString(), senderEthBefore.minus(expectedSenderLoss).toString())
            assert.equal(recieverTokensAfter.toString(), recieverTok1Before.plus(expectedRecierverGain).toString())
        });

        it("max dest amount is larger than as expected dest amount", async function () {
            const maxDestAmount = amount.times(1/rate).times(1.4);
            txInfo = await payWrapper.pay(ethAddress, amount, token1.address, reciever, maxDestAmount, 0, 0, paymentData,
                    0, kyberNetwork.address, {value: amount})

            const expectedActualSrcAmount = amount;
            expectedSenderLoss = expectedActualSrcAmount.plus(await getGasCost(txInfo));
            expectedRecierverGain = amount.times(1/rate);
            
            senderEthAfter = await Helper.getBalancePromise(admin);
            recieverTokensAfter = await token1.balanceOf(reciever);
            
            assert.equal(senderEthAfter.toString(), senderEthBefore.minus(expectedSenderLoss).toString())
            assert.equal(recieverTokensAfter.toString(), recieverTok1Before.plus(expectedRecierverGain).toString())
        });
    });

    describe('token to eth', function () {
        const from = other;
        const amount = 100;

        xit("max dest amount is exactly src amount", async function () {});
        xit("event is emitted correctly", async function () {});
        xit("max dest amount is smaller than src amount", async function () {});
        xit("max dest amount is larger than src amount", async function () {});
        xit("without sending enough eth", async function () {});
        xit("verify allowance of pay wrapper is 0 after the payment", async function () {});
    });

    describe('token to another token', function () {});

    describe('check withdrawable', function () {
        const from = other;
        const amount = 100;

        xit("can withdraw ether", async function () {});
        xit("can withdraw tokens", async function () {});
        xit("can transfer admin", async function () {});
    });

    describe('no reentrancy', function () {
        const from = other;
        const amount = 100;

        xit("can not create reentrancy", async function () {});
    });
});

