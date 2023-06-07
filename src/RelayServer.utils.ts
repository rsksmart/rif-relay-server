export function secondsToDate(dateInSeconds: number) {
    return new Date(dateInSeconds * 1000);
}

export const expiredTimeErrorMessage = (
    requestExpirationDate: Date,
    minimumAcceptableDate: Date
) =>
    `Request expired (or too close): expiration date received "${requestExpirationDate.toUTCString()}" is expected to be greater than or equal to "${minimumAcceptableDate.toUTCString()}"`;

export async function validateExpirationTime(
    validUntilTime: string,
    requestMinValidSeconds: number
) {
    const parsedValidUntilTime = parseInt(validUntilTime);
    const secondsNow = Math.round(Date.now() / 1000);
    const expiredInSeconds = parsedValidUntilTime - secondsNow;
    if (expiredInSeconds < requestMinValidSeconds) {
        const expirationDate = secondsToDate(parsedValidUntilTime);
        const minimumAcceptableDate = secondsToDate(
            secondsNow + requestMinValidSeconds
        );
        throw new Error(
            expiredTimeErrorMessage(expirationDate, minimumAcceptableDate)
        );
    }
}
