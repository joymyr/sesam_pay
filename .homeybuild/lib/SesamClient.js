"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SesamClient = void 0;
const node_html_parser_1 = require("node-html-parser");
class SesamClient {
    /**
     * Sjekker om det finnes ubetalte parkeringer for et gitt registreringsnummer.
     * @param regNumber Bilens registreringsnummer (f.eks. "AB12345")
     */
    static async checkUnpaid(regNumber) {
        const cleanReg = regNumber.replace(/\s+/g, '').toLowerCase();
        const url = `${this.BASE_URL}?action=sesamsesam_notpaid&regnr=${encodeURIComponent(cleanReg)}`;
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'User-Agent': this.USER_AGENT,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Referer': 'https://sesam-sesam.com/betal-for-parkering/',
            },
        });
        if (!response.ok) {
            throw new Error(`Feil ved oppslag mot Sesam Sesam: ${response.status} ${response.statusText}`);
        }
        const html = await response.text();
        return this.parseNotPaidHtml(cleanReg.toUpperCase(), html);
    }
    /**
     * Henter direktelenke til betaling via Nets / betalingsløsning for en eller flere parkeringer.
     * @param paymentIds Enkelt-ID eller liste over parkerings-IDer (UUID)
     * @param email Valgfri e-postadresse for kvittering
     */
    static async getPaymentRedirectUrl(paymentIds, email) {
        const idParam = Array.isArray(paymentIds) ? paymentIds.join(',') : paymentIds;
        let url = `${this.BASE_URL}?action=sesamsesam_topayment&payments=${encodeURIComponent(idParam)}`;
        if (email) {
            url += `&email=${encodeURIComponent(email)}`;
        }
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'User-Agent': this.USER_AGENT,
                'Accept': 'application/json, text/javascript, */*; q=0.01',
                'Referer': 'https://sesam-sesam.com/betal-for-parkering/',
            },
        });
        if (!response.ok) {
            throw new Error(`Kunne ikke hente betalingslenke: ${response.status} ${response.statusText}`);
        }
        const data = await response.json();
        if (!data || !data.redirectUrl) {
            throw new Error('Uventet respons fra Sesam Sesam ved generering av betalingslenke');
        }
        return {
            paymentId: idParam,
            redirectUrl: data.redirectUrl,
        };
    }
    /**
     * Parser HTML-responsen fra Sesam Sesam.
     */
    static parseNotPaidHtml(regNumber, html) {
        const root = (0, node_html_parser_1.parse)(html);
        // Hvis responsen inneholder notfound eller mangler list_holder / payment_wrapper
        const notFoundElem = root.querySelector('.sesamsesam-parking-notfound');
        const paymentWrappers = root.querySelectorAll('.payment_wrapper');
        if (notFoundElem || paymentWrappers.length === 0) {
            return {
                regNumber,
                hasUnpaid: false,
                totalAmount: 0,
                currency: 'NOK',
                parkings: [],
                checkedAt: new Date(),
            };
        }
        // Finn eier hvis oppgitt (f.eks. "Bergen Parkering AS")
        let owner;
        const ownerElem = root.querySelector('.cscustomer_h2');
        if (ownerElem) {
            const ownerText = ownerElem.text.trim();
            owner = ownerText.replace(/^Eieren:\s*/i, '').trim();
        }
        const parkings = [];
        for (const pw of paymentWrappers) {
            const item = this.parseParkingWrapper(pw, owner);
            if (item) {
                parkings.push(item);
            }
        }
        // Beregn eller hent totalbeløp
        let totalAmount = 0;
        const totalElem = root.querySelector('.sesamsesam-parking-total-amount-diff');
        if (totalElem) {
            totalAmount = this.parseAmount(totalElem.text);
        }
        else {
            totalAmount = parkings.reduce((sum, p) => sum + p.amount, 0);
        }
        return {
            regNumber,
            hasUnpaid: parkings.length > 0,
            totalAmount,
            currency: 'NOK',
            parkings,
            checkedAt: new Date(),
        };
    }
    static parseParkingWrapper(wrapper, defaultOwner) {
        // ID fra input checkbox
        const inputElem = wrapper.querySelector('input.sesamsesam-parking-payment-diff');
        const id = inputElem?.getAttribute('data-id') || inputElem?.getAttribute('id') || '';
        // Anleggsnavn fra <h3>
        const h3Elem = wrapper.querySelector('h3');
        const facility = h3Elem ? h3Elem.text.replace(/[\n\r]+/g, ' ').replace(/\s+/g, ' ').trim() : 'Ukjent anlegg';
        // Tidspunkt og varighet fra <p> som har ikoner
        const pElements = wrapper.querySelectorAll('.m_payment.list .wpb_wrapper p');
        let dateRangeText = '';
        let durationStr = '';
        for (const p of pElements) {
            const fullText = p.text;
            if (p.querySelector('.fa-calendar-alt') || fullText.includes('(') && fullText.includes(')')) {
                dateRangeText = fullText;
            }
            if (p.querySelector('.fa-clock') || fullText.includes('timer') || fullText.includes('minutter')) {
                const clockMatch = fullText.match(/\b\d+\s*timer.*|\b\d+\s*minutter.*/i);
                if (clockMatch) {
                    durationStr = clockMatch[0].trim();
                }
            }
        }
        const { startTime, endTime, startTimeStr, endTimeStr } = this.parseDateRange(dateRangeText);
        // Beløp
        const amountElem = wrapper.querySelector('.sesamsesam-parking-amount-diff');
        const amount = amountElem ? this.parseAmount(amountElem.text) : 0;
        // Frist = endTime + 48 timer
        let deadline = null;
        let hoursRemaining;
        if (endTime) {
            deadline = new Date(endTime.getTime() + 48 * 60 * 60 * 1000);
            const diffMs = deadline.getTime() - Date.now();
            hoursRemaining = Math.max(0, Math.round((diffMs / (1000 * 60 * 60)) * 10) / 10);
        }
        return {
            id: id || `${facility}-${Date.now()}`,
            facility,
            owner: defaultOwner,
            startTime,
            endTime,
            startTimeStr,
            endTimeStr,
            durationStr,
            amount,
            currency: 'NOK',
            deadline,
            hoursRemaining,
        };
    }
    /**
     * Parser beløp fra format som "24,00" eller "24.00" til number.
     */
    static parseAmount(text) {
        const cleaned = text.replace(/[^\d.,]/g, '').replace(',', '.');
        const num = parseFloat(cleaned);
        return isNaN(num) ? 0 : num;
    }
    /**
     * Parser datoer fra format som "09.09.2026 (11:15) - 09.09.2026 (11:39)"
     */
    static parseDateRange(text) {
        // Matcher dato og klokkeslett som "DD.MM.YYYY (HH:mm)"
        const datePattern = /(\d{2})\.(\d{2})\.(\d{4})\s*\(([0-2]?\d:[0-5]\d)\)/g;
        const matches = Array.from(text.matchAll(datePattern));
        let startTime = null;
        let endTime = null;
        let startTimeStr;
        let endTimeStr;
        if (matches.length >= 1) {
            startTime = this.parseNorwegianDateTime(matches[0][1], matches[0][2], matches[0][3], matches[0][4]);
            startTimeStr = `${matches[0][1]}.${matches[0][2]}.${matches[0][3]} ${matches[0][4]}`;
        }
        if (matches.length >= 2) {
            endTime = this.parseNorwegianDateTime(matches[1][1], matches[1][2], matches[1][3], matches[1][4]);
            endTimeStr = `${matches[1][1]}.${matches[1][2]}.${matches[1][3]} ${matches[1][4]}`;
        }
        return { startTime, endTime, startTimeStr, endTimeStr };
    }
    static parseNorwegianDateTime(day, month, year, time) {
        const [hours, minutes] = time.split(':').map(Number);
        return new Date(Number(year), Number(month) - 1, Number(day), hours, minutes, 0, 0);
    }
}
exports.SesamClient = SesamClient;
SesamClient.BASE_URL = 'https://sesam-sesam.com/wp-admin/admin-ajax.php';
SesamClient.USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
