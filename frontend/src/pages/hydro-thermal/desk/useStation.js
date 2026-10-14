import { useEffect, useState } from 'react';
import api from '../../../api/client.js';

/** The hydro stations, and the one the desk is working on. */
export function useStation(vertical = 'HYDRO') {
  const [stations, setStations] = useState([]);
  const [stationId, setStationId] = useState('');
  const [accounts, setAccounts] = useState([]);
  useEffect(() => {
    api.hydroBilling.stations({ vertical })
      .then((list) => { setStations(list || []); if (list?.length) setStationId((cur) => cur || list[0].id); })
      .catch(() => setStations([]));
  }, []);
  useEffect(() => {
    if (!stationId) { setAccounts([]); return; }
    api.hydroBilling.accounts({ contract_id: stationId }).then((a) => setAccounts(a || [])).catch(() => setAccounts([]));
  }, [stationId]);
  return { stations, stationId, setStationId, beneficiaries: accounts.map((a) => a.beneficiary_name) };
}

export const errOf = (err, fallback) => err?.response?.data?.error || err?.message || fallback;
