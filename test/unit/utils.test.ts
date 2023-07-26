import type { RelayHub } from "@rsksmart/rif-relay-contracts";
import { expect } from "chai";
import sinon from "sinon";
import * as utils from "src/Utils";
import { getPastEventsForHub } from "src/getPastEventsForHub";

describe.only('getPastEventsFromHub', function() {
    it('should fail', async function () {
        const eventMapping = {
            'RelayServerRegistered': [{
                name: 'event-RelayServerRegistered'
            }],
            'RelayWorkersAdded': [{
                name: 'event-RelayWorkersAdded'
            }]
        };
        const filterProxy = new Proxy({}, {
            get: function(_, name, __) {
                return () => name
            },
        });
        const stubRelayHub = {
            interface: {
                getEventTopic: (name: string) => name
            },
            filters: filterProxy,
            queryFilter: (filter: 'RelayServerRegistered' | 'RelayWorkersAdded') => eventMapping[filter]
        } as unknown as RelayHub;
        sinon.stub(utils, 'getRelayHub').returns(stubRelayHub);
        const events = await getPastEventsForHub("0x123abc", {}, ['RelayServerRegistered']);
        expect(events).to.eql(eventMapping['RelayServerRegistered']);
    });

    it('should not split the if the blocks involved are less than or equal to 1000', function () {
       expect(true).to.be.false;
    })

    it('should split the request into multiple ones if the blocks involved are more than 1000', function () {
        expect(true).to.be.false;
    })
});