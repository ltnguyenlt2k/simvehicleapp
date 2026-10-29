"""M22 actual DDS probe, including controlled SIM motion. Always disarms in finally."""
import json, math, time, uuid
from pathlib import Path
import rclpy
from rclpy.node import Node
from rclpy.parameter import Parameter
from sensor_msgs.msg import Imu
from geometry_msgs.msg import TwistStamped
from std_msgs.msg import String
from dog_interfaces.msg import FootContacts
from rosgraph_msgs.msg import Clock
from rclpy.qos import qos_profile_sensor_data

rclpy.init()
node=Node("protobus_m22_probe")
node.set_parameters([Parameter("use_sim_time",Parameter.Type.BOOL,True)])
state={}; acks={}; samples={"imu":0,"feet":0,"safe":0}; last_safe=[0,0]
def receive_brain(msg): state.update(json.loads(msg.data))
def receive_ack(msg):
    data=json.loads(msg.data); acks[data["request_id"]]=data
def imu(msg): samples["imu"]+=1
def feet(msg): samples["feet"]+=1
def safe(msg):
    samples["safe"]+=1
    last_safe[:]=[msg.twist.linear.x,msg.twist.angular.z]
subscriptions=[
node.create_subscription(String,"/dog1/brain/state",receive_brain,10),
node.create_subscription(String,"/dog1/control/ack",receive_ack,10),
node.create_subscription(Imu,"/dog1/imu/data",imu,qos_profile_sensor_data),
node.create_subscription(FootContacts,"/dog1/foot_contacts",feet,qos_profile_sensor_data),
node.create_subscription(TwistStamped,"/dog1/cmd_vel/safe",safe,10)]
publisher=node.create_publisher(String,"/dog1/control/request",10)
def wait(predicate,timeout=20):
    end=time.monotonic()+timeout
    while time.monotonic()<end:
        rclpy.spin_once(node,timeout_sec=.02)
        if predicate(): return
    raise AssertionError("DDS condition timeout: "+json.dumps({"state":state,"samples":samples}))
def dispatch(action,**props):
    rid=str(uuid.uuid4())
    payload={"schema":1,"config_hash":state["config_hash"],"issued_at_ns":node.get_clock().now().nanoseconds,"request_id":rid,"action":action,**props}
    publisher.publish(String(data=json.dumps(payload)))
    wait(lambda:rid in acks,4)
    if not acks[rid]["accepted"]: raise AssertionError(acks[rid])
    return rid
report={"schema":"m22-probe.v1","source":"actual DDS + MuJoCo SIM","motions":{}}
try:
    wait(lambda: samples["imu"]>=20 and samples["feet"]>=5 and state.get("ready") and node.get_clock().now().nanoseconds>0,60)
    report["discovery"]={"samples":dict(samples),"boot_id":state.get("boot_id"),"scene_epoch":state.get("scene_epoch"),"config_hash":state["config_hash"]}
    dispatch("disarm")
    if state.get("mode")=="SAFE_STOP": dispatch("reset_stop")
    dispatch("arm");wait(lambda:state.get("mode")=="MANUAL")
    for name in ("crouch","bow","tilt","lift_fl","jump"):
        start=time.monotonic()
        rid=dispatch("motion",motion_name=name)
        wait(lambda:state.get("motion",{}).get("motion_id")==rid and state["motion"].get("phase") in ("SUCCEEDED","FAILED","REJECTED","CANCELLED"),20)
        result=state["motion"]
        if result["phase"]!="SUCCEEDED": raise AssertionError(result)
        wait(lambda:state.get("mode")=="MANUAL" and not state.get("active_motion_id"))
        report["motions"][name]={"elapsed_s":round(time.monotonic()-start,3),"request_id":rid,"phase":result["phase"],"evidence":dict(result)}
    # Manual watchdog must stop output after fresh command stream disappears.
    moving=False
    for _ in range(12):
        dispatch("manual",linear=.15,angular=0)
        deadline=time.monotonic()+.05
        while time.monotonic()<deadline:
            rclpy.spin_once(node,timeout_sec=.005)
            moving=moving or last_safe[0]>.05
    if not moving: raise AssertionError("No positive velocity observed on cmd_vel/safe")
    start=time.monotonic()
    wait(lambda:abs(last_safe[0])<1e-6 and abs(last_safe[1])<1e-6,1)
    latency=time.monotonic()-start
    if latency>.5: raise AssertionError(f"watchdog stop {latency}s")
    report["watchdog_stop_s"]=round(latency,4)
    report["samples"]=samples
    report["status"]="PASS"
except Exception as exc:
    report["status"]="FAIL";report["error"]=str(exc)
finally:
    if state.get("config_hash"):
        try: dispatch("disarm")
        except Exception as exc: report["cleanup_error"]=str(exc);report["status"]="FAIL"
    Path("/evidence/m22-dds-probe.json").write_text(json.dumps(report,indent=2))
    node.destroy_node();rclpy.shutdown()
print(json.dumps(report))
if report["status"]!="PASS": raise SystemExit(1)
