"""Lifecycle unit gate only; no backend or transport confirmation is fabricated."""
import unittest
from protobus.v1 import protobus_pb2 as pb
from targets import HoldLedger,TargetError


class HoldLifecycleTests(unittest.TestCase):
    def setUp(self):self.ledger=HoldLedger()
    def stage(self,sequence=1,deadline=100,release=False,owner='owner'):
        return self.ledger.stage('Robot.Motion.Velocity',owner,1,'provider',sequence,deadline,release)
    def feedback(self,record,number,phase,confirmed=False,**changes):
        fields=dict(identity=record.id,path=record.path,session=record.session,sequence=number,phase=phase,physical_confirmed=confirmed)
        fields.update(changes);return self.ledger.feedback(**fields)

    def test_receipt_and_admission_do_not_confirm_release(self):
        record,_=self.stage();self.assertEqual(record.phase,pb.PENDING)
        self.feedback(record,1,pb.RUNNING)
        self.assertEqual(record.accepted_sequence,1);self.assertFalse(record.physical_released)
        self.assertTrue(self.ledger.quarantined)
        with self.assertRaises(TargetError):self.feedback(record,1,pb.SUCCEEDED,True)

    def test_release_requires_same_identity_and_release_sequence(self):
        record,_=self.stage();self.stage(2,200,True)
        for changes in ({'session':'old'},{'path':'Robot.Other'},{'sequence':3},{'sequence':1}):
            with self.subTest(changes=changes),self.assertRaises(TargetError):self.feedback(record,2,pb.SUCCEEDED,True,**changes)
        self.assertFalse(record.physical_released)
        self.feedback(record,2,pb.SUCCEEDED,True)
        self.assertTrue(record.physical_released);self.assertFalse(self.ledger.quarantined)

    def test_refresh_retries_keep_one_identity_and_cannot_extend_cleanup_deadline(self):
        record,_=self.stage();refreshed,_=self.stage(2,150)
        self.assertIs(record,refreshed)
        self.stage(3,200,True);self.stage(4,999999,True)
        self.assertEqual(record.deadline_ns,200)
        self.feedback(record,3,pb.SUCCEEDED,True)
        same,dispatch=self.stage(5,999999,True)
        self.assertIs(same,record);self.assertFalse(dispatch)
        self.assertEqual(record.physical_sequence,3)
        with self.assertRaises(TargetError):self.stage(6,999999,False)

    def test_late_admission_cannot_undo_release_and_conflicting_terminal_is_rejected(self):
        record,_=self.stage();self.stage(2,200,True);self.feedback(record,2,pb.SUCCEEDED,True)
        self.feedback(record,1,pb.RUNNING)
        self.assertEqual(record.phase,pb.SUCCEEDED)
        self.assertTrue(self.feedback(record,2,pb.SUCCEEDED,True).physical_released)
        with self.assertRaises(TargetError):self.feedback(record,2,pb.FAILED,True)

    def test_timeout_preserves_logical_result_after_late_correlated_release(self):
        record,_=self.stage();self.stage(2,200,True)
        self.assertEqual(self.ledger.expire(200),[record]);self.assertTrue(self.ledger.quarantined)
        self.feedback(record,2,pb.SUCCEEDED,True)
        self.assertEqual(record.phase,pb.TIMED_OUT);self.assertEqual(record.physical_phase,pb.SUCCEEDED)

    def test_failed_refresh_cannot_claim_release_of_an_earlier_admitted_target(self):
        record,_=self.stage();self.feedback(record,1,pb.RUNNING);self.stage(2,150)
        with self.assertRaises(TargetError):self.feedback(record,2,pb.REJECTED,True)
        self.feedback(record,2,pb.FAILED,False);self.assertTrue(self.ledger.quarantined)
        self.stage(3,200,True)
        with self.assertRaises(TargetError):self.feedback(record,2,pb.CANCELLED,True)
        self.feedback(record,3,pb.SUCCEEDED,True)
        self.assertEqual(record.phase,pb.FAILED);self.assertTrue(record.physical_released)

    def test_recovery_resource_clear_is_not_old_physical_confirmation(self):
        record,_=self.stage();self.ledger.revoke(1);self.ledger.recover()
        self.assertEqual(record.phase,pb.CANCELLED);self.assertFalse(self.ledger.quarantined)
        self.assertFalse(record.physical_released)

    def test_bounded_history_never_evicts_unconfirmed_active_resource(self):
        self.ledger=HoldLedger(1);record,_=self.stage()
        with self.assertRaises(TargetError):self.stage(owner='another')
        self.ledger.expire(100);self.ledger.recover()
        new,_=self.stage(owner='another');self.assertNotEqual(new.id,record.id)
        self.assertNotIn(record.id,self.ledger.records)
