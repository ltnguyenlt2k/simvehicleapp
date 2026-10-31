"""Explicit test-only SIM parameter action; no sensor or motion publisher."""
import argparse,json,time
import rclpy
from rcl_interfaces.srv import SetParameters
from rclpy.parameter import Parameter

def main():
 parser=argparse.ArgumentParser();parser.add_argument('--soc',type=float,required=True);args=parser.parse_args()
 rclpy.init();node=rclpy.create_node('workflow_battery_stimulus')
 try:
  client=node.create_client(SetParameters,'/dog_sim/set_parameters')
  assert client.wait_for_service(timeout_sec=10)
  future=client.call_async(SetParameters.Request(parameters=[Parameter('sim_battery_soc',value=args.soc).to_parameter_msg()]))
  end=time.monotonic()+5
  while not future.done():
   assert time.monotonic()<end
   rclpy.spin_once(node,timeout_sec=.02)
  assert future.result().results[0].successful
  print(json.dumps({'accepted':True,'simBatterySoc':args.soc}))
 finally:node.destroy_node();rclpy.shutdown()

if __name__=='__main__':main()
