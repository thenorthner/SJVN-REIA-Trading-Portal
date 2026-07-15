import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, Descriptions, Table, Button, Space, Typography, Tag, Modal, Form, Input, Select, Badge, message } from 'antd';
import { ExclamationCircleOutlined } from '@ant-design/icons';
import api from '../../api/client';

const { Title, Text } = Typography;
const { confirm } = Modal;

export default function TradingClientProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [client, setClient] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchProfile();
  }, [id]);

  const fetchProfile = () => {
    setLoading(true);
    api.tradingClients.get(id).then(res => {
      setClient(res.data);
      setLoading(false);
    }).catch(err => {
      message.error("Failed to load profile");
      setLoading(false);
    });
  };

  const handleSuspend = () => {
    confirm({
      title: 'Suspend Trading Client',
      icon: <ExclamationCircleOutlined style={{ color: 'red' }}/>,
      content: 'Are you sure you want to suspend this client? This will block new bids.',
      onOk() {
        api.tradingClients.suspend(id, 'Risk limit breached or manual intervention').then(() => {
          message.success("Client suspended successfully");
          fetchProfile();
        });
      }
    });
  };

  if (loading) return <div style={{ padding: 24 }}>Loading...</div>;
  if (!client) return <div style={{ padding: 24 }}>Client not found</div>;

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Title level={3}>Profile: {client.name}</Title>
        <Space>
          <Button onClick={() => navigate('/trading/clients')}>Back to List</Button>
          {client.status === 'ACTIVE' && <Button danger onClick={handleSuspend}>Suspend Client</Button>}
        </Space>
      </div>

      <Card title="Master & Operational Details" style={{ marginBottom: 24 }}>
        <Descriptions bordered column={2}>
          <Descriptions.Item label="Client ID">{client.id}</Descriptions.Item>
          <Descriptions.Item label="Type"><Tag>{client.client_type}</Tag></Descriptions.Item>
          <Descriptions.Item label="Status">
            <Badge status={client.status === 'ACTIVE' ? 'success' : 'error'} text={client.status} />
          </Descriptions.Item>
          <Descriptions.Item label="Risk Rating">
            <Tag color={client.risk_rating === 'HIGH' ? 'red' : client.risk_rating === 'LOW' ? 'green' : 'orange'}>{client.risk_rating}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="Exposure Limit">₹{client.exposure_limit?.toLocaleString('en-IN') || 0}</Descriptions.Item>
          <Descriptions.Item label="NOC Valid Till">
            <Text type={new Date(client.noc_valid_till) < new Date() ? 'danger' : 'success'}>
              {client.noc_valid_till || 'Not Uploaded'}
            </Text>
          </Descriptions.Item>
          <Descriptions.Item label="Pre-payment Balance">₹{client.pre_payment_balance.toLocaleString('en-IN')}</Descriptions.Item>
          <Descriptions.Item label="Margin Available">₹{client.margin_available.toLocaleString('en-IN')}</Descriptions.Item>
          {client.entity_details && (
            <>
              <Descriptions.Item label="PAN No.">{client.entity_details.pan_no}</Descriptions.Item>
              <Descriptions.Item label="GST No.">{client.entity_details.gst_no}</Descriptions.Item>
            </>
          )}
        </Descriptions>
      </Card>

      <Card title="Authorized Signatories" style={{ marginBottom: 24 }}>
        <Table 
          dataSource={client.signatories || []}
          rowKey="id"
          pagination={false}
          columns={[
            { title: 'Name', dataIndex: 'name' },
            { title: 'Designation', dataIndex: 'designation' },
            { title: 'Contact', dataIndex: 'contact_info' },
            { title: 'Status', dataIndex: 'is_active', render: v => <Tag color={v ? 'green' : 'red'}>{v ? 'Active' : 'Inactive'}</Tag> },
            { title: 'Added On', dataIndex: 'created_at', render: v => new Date(v).toLocaleDateString() }
          ]}
        />
      </Card>

      <Card title="Exchange Memberships">
        <Table 
          dataSource={client.exchanges || []}
          rowKey="id"
          pagination={false}
          columns={[
            { title: 'Exchange', dataIndex: 'exchange', render: v => <Tag color="blue">{v}</Tag> },
            { title: 'Registration ID', dataIndex: 'registration_id' },
            { title: 'Status', dataIndex: 'is_active', render: v => <Tag color={v ? 'green' : 'red'}>{v ? 'Active' : 'Inactive'}</Tag> },
            { title: 'Added On', dataIndex: 'created_at', render: v => new Date(v).toLocaleDateString() }
          ]}
        />
      </Card>
    </div>
  );
}
