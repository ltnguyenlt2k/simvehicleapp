import unittest
from google.protobuf import json_format
from protobus.v1 import protobus_pb2 as pb


class ProtocolTests(unittest.TestCase):
    def test_bus_methods_and_provider_control_are_separate(self):
        services = pb.DESCRIPTOR.services_by_name
        self.assertEqual(set(services['Bus'].methods_by_name), {
            'Describe', 'Get', 'Subscribe', 'AcquireLease', 'RenewLease',
            'ReleaseLease', 'SetTarget', 'Invoke', 'Cancel', 'Stop', 'InspectExecution'})
        self.assertEqual(set(services['Provider'].methods_by_name), {'Attach', 'Control', 'Safety'})
        self.assertTrue(services['Provider'].methods_by_name['Attach'].client_streaming)
        self.assertTrue(services['Provider'].methods_by_name['Control'].server_streaming)
        self.assertTrue(services['Provider'].methods_by_name['Safety'].server_streaming)

    def test_int64_json_is_decimal_string_and_roundtrips(self):
        original = pb.Sample(path='Robot.Simulation.TimeNs',
                             value=pb.Value(int64_value=2**63-1),
                             source_time_ns=2**63-2, sequence=2**64-1)
        wire_json = json_format.MessageToDict(original)
        self.assertEqual(wire_json['value']['int64Value'], str(2**63-1))
        self.assertEqual(wire_json['sourceTimeNs'], str(2**63-2))
        self.assertEqual(wire_json['sequence'], str(2**64-1))
        self.assertEqual(json_format.ParseDict(wire_json, pb.Sample()), original)

    def test_atomic_target_and_oneof(self):
        value = pb.Value(bool_value=True)
        value.float64_value = .3
        self.assertEqual(value.WhichOneof('kind'), 'float64_value')
        target = pb.Target(value=pb.Object(fields={
            'LinearX': pb.Value(float64_value=.3),
            'AngularZ': pb.Value(float64_value=0)}), sequence=1)
        self.assertEqual(pb.Target.FromString(target.SerializeToString()), target)

    def test_field_numbers_initial_compatibility_baseline(self):
        expected = {
            'Lease': {'token': 1, 'fence': 2, 'broker_epoch': 3, 'remaining_ms': 4, 'client_id': 5},
            'Samples': {'samples': 1, 'provider_session': 2, 'broker_epoch': 3},
            'CommandUpdate': {'execution_id': 1, 'phase': 2, 'reason': 3, 'provider_session': 4, 'path': 5, 'physical_confirmed': 6,'target_sequence':7},
            'Target': {'lease': 1, 'path': 2, 'value': 3, 'sequence': 4, 'owner_id': 5, 'release': 6},
            'StopReply': {'requested':1,'dispatched':2,'robot_confirmed':3,'reason':4,
                          'execution_id':5,'broker_epoch':6,'provider_session':7},
            'Descriptor': {'robot_id':1,'profile_id':2,'catalog_hash':3,'broker_epoch':4,
                           'provider_online':5,'backend':6,'host_clock_id':7,'protocol_version':8,
                           'audit_ok':9,'provider_session':10,'target_context':11},
            'ProviderHello': {'provider_id':1,'profile_id':2,'catalog_hash':3,'session':4,
                              'claims':5,'backend':6,'host_clock_id':7,'protocol_version':8,'target_context':9},
        }
        for message, fields in expected.items():
            self.assertEqual({f.name: f.number for f in pb.DESCRIPTOR.message_types_by_name[message].fields}, fields)

    def test_unknown_fields_survive_old_reader_roundtrip(self):
        # Field 100, varint 1, represents a future additive field.
        future = pb.Lease(token='x').SerializeToString() + bytes([0xa0, 0x06, 0x01])
        self.assertEqual(pb.Lease.FromString(future).SerializeToString(), future)


if __name__ == '__main__':
    unittest.main()
