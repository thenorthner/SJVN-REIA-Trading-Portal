import React from 'react';
import { PageHeader } from '../../components/ui.jsx';
import ReiaReportsTab from '../reia/ReiaReportsTab.jsx';

/**
 * A seller's or a buyer's Reports page. It is the REIA Dashboard's Reports
 * tab: the API cuts every report to the rows the company is a party to,
 * leaves out SJVN's own columns, and names the reports from its side.
 */
export default function MyReports({ subtitle }) {
  return (
    <div>
      <PageHeader title="Reports" subtitle={subtitle} />
      <ReiaReportsTab />
    </div>
  );
}
