/**************************************************************************
 *  (C) Copyright ModusBox Inc. 2019 - All rights reserved.               *
 *                                                                        *
 *  This file is made available under the terms of the license agreement  *
 *  specified in the corresponding source code repository.                *
 *                                                                        *
 *  ORIGINAL AUTHOR:                                                      *
 *       James Bush - james.bush@modusbox.com                             *
 **************************************************************************/

'use strict';

const util = require('util');
const Crypto = require('crypto');
const base64url = require('base64url');

// must be pinned at ilp-packet@2.2.0 for ILP v1 compatibility
const ilpPacket = require('ilp-packet');

// currency decimal place data
const currencyDecimals = require('./currency.json');


/**
 * An abstraction of ILP suitable for the Mojaloop API ILP requirements
 */
class Ilp {
    constructor(config) {
        this.secret = config.secret;
        this.logger = config.logger || console;
    }


    /**
     * Generates the required fulfilment, ilpPacket and condition for a quote response 
     *
     * @returns {object} - object containing the fulfilment, ilp packet and condition values
     */
    getQuoteResponseIlp(quoteRequest, quoteResponse) {
        const transactionObject = {
            transactionId: quoteRequest.transactionId,
            quoteId: quoteRequest.quoteId,
            payee: quoteRequest.payee,
            payer: quoteRequest.payer,
            amount: quoteResponse.transferAmount,
            transactionType: quoteRequest.transactionType,
            note: quoteResponse.note
        };

        const ilpData = Buffer.from(base64url(JSON.stringify(transactionObject)));
        const packetInput = {
            amount: this._getIlpCurrencyAmount(quoteResponse.transferAmount), // unsigned 64bit integer as a string
            account: this._getIlpAddress(quoteRequest.payee), // ilp address
            data: ilpData // base64url encoded attached data
        };

        const packet = ilpPacket.serializeIlpPayment(packetInput);

        let base64encodedIlpPacket = base64url.fromBase64(packet.toString('base64')).replace('"', '');

        let generatedFulfilment = this.caluclateFulfil(base64encodedIlpPacket).replace('"', '');
        let generatedCondition = this.calculateConditionFromFulfil(generatedFulfilment).replace('"', '');

        const ret = {
            fulfilment: generatedFulfilment,
            ilpPacket: base64encodedIlpPacket,
            condition: generatedCondition
        };

        // this.logger.log(`Generated ILP: transaction object: ${util.inspect(transactionObject)}\nPacket input: ${util.inspect(packetInput)}\nOutput: ${util.inspect(ret)}`);

        return ret;
    }


    /**
     * Returns an ILP compatible amount as an unsigned 64bit integer as a string given a mojaloop
     * API spec amount object. Note that this is achieved by multiplying the amount by 10 ^ number
     * of decimal places.
     *
     * @returns {string} - unsigned 64bit integer as string
     */
    _getIlpCurrencyAmount(mojaloopAmount) {
        const { currency, amount } = mojaloopAmount;

        if(typeof(currencyDecimals[currency]) === 'undefined') {
            throw new Error(`No decimal place data available for currency ${currency}`);
        }

        const decimalPlaces = currencyDecimals[currency];
        return `${Number(amount) * Math.pow(10, decimalPlaces)}`;
    }


    /**
     * Returns an ILP compatible address string given a mojaloop API spec party object.
     * Note that this consists of 4 parts:
     *  1. ILP address allocation scheme identifier (always the global allocation scheme)
     *  2. FSPID of the DFSP owning the party account
     *  3. Identifier type being used to identify the account
     *  4. Identifier of the account
     *
     * @returns {string} - ILP address of the specified party
     */
    _getIlpAddress(mojaloopParty) {
        // validate input
        if(!mojaloopParty || typeof(mojaloopParty) !== 'object') {
            throw new Error('ILP party must be an objcet');
        }
        if(!mojaloopParty.partyIdInfo || typeof(mojaloopParty.partyIdInfo) !== 'object') {
            throw new Error('ILP party does not contain required partyIdInfo object');
        }
        if(!mojaloopParty.partyIdInfo.partyIdType || typeof(mojaloopParty.partyIdInfo.partyIdType) !== 'string') {
            throw new Error('ILP party does not contain required partyIdInfo.partyIdType string value');
        }
        if(!mojaloopParty.partyIdInfo.partyIdentifier || typeof(mojaloopParty.partyIdInfo.partyIdType) !== 'string') {
            throw new Error('ILP party does not contain required partyIdInfo.partyIdentifier string value');
        }

        return 'g' // ILP global address allocation scheme
            + `.${mojaloopParty.partyIdInfo.fspId}` // fspId of the party account
            + `.${mojaloopParty.partyIdInfo.partyIdType.toLowerCase()}` // identifier type
            + `.${mojaloopParty.partyIdInfo.partyIdentifier.toLowerCase()}`; // identifier value
    }


    /**
     * Validates a fulfilment against a condition
     *
     * @returns {boolean} - true is the fulfilment is valid, otherwise false
     */
    validateFulfil(fulfilment, condition) {
        let preimage = base64url.toBuffer(fulfilment);

        if (preimage.length !== 32) {
            return false;
        }

        let calculatedConditionDigest = this._sha256(preimage);
        let calculatedConditionUrlEncoded = base64url.fromBase64(calculatedConditionDigest);

        return (calculatedConditionUrlEncoded === condition);
    }


    /**
     * Calculates a fulfilment given a base64 encoded ilp packet and a secret
     *
     * @returns {string} - string containing base64 encoded fulfilment
     */
    caluclateFulfil(base64EncodedPacket) {
        var encodedSecret = Buffer.from(this.secret).toString('base64');

        var hmacsignature = Crypto.createHmac('sha256', new Buffer(encodedSecret, 'ascii'))
            .update(new Buffer(base64EncodedPacket, 'ascii'));

        var generatedFulfilment = hmacsignature.digest('base64');

        return base64url.fromBase64(generatedFulfilment);
    }


    /**
     * Calculates a condition from a fulfilment
     *
     * @returns {string} - base64 encoded condition calculated from supplied fulfilment
     */
    calculateConditionFromFulfil (fulfilment) {
        var preimage = base64url.toBuffer(fulfilment);
        
        if (preimage.length !== 32) {
            throw new Error('Interledger preimages must be exactly 32 bytes.');
        }
        
        var calculatedConditionDigest = this._sha256(preimage);
        return base64url.fromBase64(calculatedConditionDigest);
    }

    _sha256 (preimage) {
        return Crypto.createHash('sha256').update(preimage).digest('base64');
    }
}


module.exports = Ilp;
