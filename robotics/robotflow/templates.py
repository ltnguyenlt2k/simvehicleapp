"""Owned example graph data. Loading a template never runs or authorizes it."""
import json
from pathlib import Path

from registry import load_registry


class Graph:
    def __init__(self,registry):
        self.registry=registry
        self.nodes=[];self.edges=[]

    def add(self,identity,block,props=None):
        index=len(self.nodes)
        self.nodes.append(dict(id=identity,block='rf.'+block,v=1,props=props or {},
            ui={'x':(index%5)*320,'y':(index//5)*180}))
        return identity

    def link(self,identity,port,target):
        self.edges.append({'from':[identity,port],'to':[target,'in']})

    def results(self,identity,succeeded,failed):
        for phase in ('succeeded','failed','rejected','cancelled','timed_out'):
            self.link(identity,phase,succeeded if phase=='succeeded' else failed)

    def cleanup(self,prefix):
        entry=self.add(prefix+'_join','join')
        stop=self.add(prefix+'_stop','stop')
        done=self.add(prefix+'_stopped','join')
        log=self.add(prefix+'_log','log',{'level':'error','message':'Không hoàn tất; đã yêu cầu dừng an toàn.'})
        end=self.add(prefix+'_end','end')
        self.link(entry,'next',stop)
        for phase in ('succeeded','failed','rejected','cancelled','timed_out'):self.link(stop,phase,done)
        self.link(done,'next',log);self.link(log,'next',end)
        return entry

    def setup(self,trigger,next_node,failure):
        check=self.add('setup_check','if',{'when':'Robot.Safety.IsStopLatched'})
        reset=self.add('setup_reset','reset_stop')
        join=self.add('setup_join','join')
        arm=self.add('setup_arm','arm')
        self.link(trigger,'next',check);self.link(check,'then',reset);self.link(check,'else',join)
        self.results(reset,join,failure);self.link(join,'next',arm);self.results(arm,next_node,failure)

    def complete(self,identity,failure,message):
        disarm=self.add(identity+'_disarm','disarm')
        log=self.add(identity+'_log','log',{'level':'info','message':message})
        end=self.add(identity+'_end','end')
        self.results(disarm,log,failure);self.link(log,'next',end)
        return disarm

    def value(self):
        profile=json.loads((Path(__file__).parent/'profiles/dog-go2-sim.json').read_text())
        return dict(schema='robotflow.v1',rss={'version':'0.1','catalogHash':profile['catalogHash']},
            profile=profile['id'],vars={},nodes=self.nodes,edges=self.edges)


def templates():
    registry=load_registry()
    result={}
    graph=Graph(registry)
    trigger=graph.add('marker','on_condition',{'when':'Robot.Perception.Marker.Count > 0','forMs':100})
    failure=graph.cleanup('failure')
    lift=graph.add('lift','perform',{'name':'LIFT_FRONT_LEFT'})
    bow=graph.add('bow','perform',{'name':'BOW'})
    done=graph.complete('complete',failure,'Đã nhấc chân và cúi chào; robot đã Disarm.')
    graph.setup(trigger,lift,failure);graph.results(lift,bow,failure);graph.results(bow,done,failure)
    result['RW-A']=graph.value()

    graph=Graph(registry)
    trigger=graph.add('start','on_start')
    failure=graph.cleanup('failure')
    loop=graph.add('patrol_loop','loop',{'count':2})
    patrol=graph.add('patrol','patrol',{'waypoints':[[.8,0.],[-.8,0.],[0.,0.]],'count':1})
    body_failure=graph.cleanup('patrol_failure')
    body_end=graph.add('patrol_end','end')
    done=graph.complete('complete',failure,'Đã hoàn tất hai vòng tuần tra; robot đã Disarm.')
    graph.setup(trigger,loop,failure);graph.link(loop,'body',patrol);graph.link(loop,'done',done)
    graph.results(patrol,body_end,body_failure)
    monitor=graph.add('obstacle','on_condition',{'when':'Robot.Perception.Obstacle.FrontMinDistance < 0.5 m','forMs':100})
    stop=graph.add('obstacle_stop','stop');join=graph.add('obstacle_stopped','join')
    log=graph.add('obstacle_log','log',{'level':'warn','message':'Có vật cản: đã yêu cầu dừng ưu tiên.'})
    end=graph.add('obstacle_end','end')
    graph.link(monitor,'next',stop)
    for phase in ('succeeded','failed','rejected','cancelled','timed_out'):graph.link(stop,phase,join)
    graph.link(join,'next',log);graph.link(log,'next',end)
    result['RW-B']=graph.value()

    graph=Graph(registry)
    trigger=graph.add('jump_event','on_event',{'name':'jump'})
    failure=graph.cleanup('failure')
    jump=graph.add('jump','perform',{'name':'JUMP'})
    done=graph.complete('complete',failure,'Đã nhảy theo sự kiện; robot đã Disarm.')
    graph.setup(trigger,jump,failure);graph.results(jump,done,failure)
    result['RW-C']=graph.value()

    graph=Graph(registry)
    trigger=graph.add('start','on_start')
    failure=graph.cleanup('failure')
    loop=graph.add('monitor_lifetime','loop',{'forever':True})
    wait=graph.add('monitor_wait','wait',{'durationMs':1000});body_end=graph.add('monitor_iteration','end');end=graph.add('main_end','end')
    graph.setup(trigger,loop,failure);graph.link(loop,'body',wait);graph.link(wait,'next',body_end);graph.link(loop,'done',end)
    low=graph.add('battery_low','on_condition',{'when':'Robot.PowerSystem.Battery.StateOfCharge < 20 %','forMs':5000})
    cancel=graph.add('cancel','cancel');crouch=graph.add('crouch','perform',{'name':'CROUCH'})
    disarm=graph.add('low_disarm','disarm');stop=graph.add('low_stop','stop');join=graph.add('low_stopped','join')
    log=graph.add('low_log','log',{'level':'warn','message':'Pin yếu kéo dài: đã hạ thân và kết thúc an toàn.'})
    end=graph.add('low_end','end')
    graph.link(low,'next',cancel);graph.results(cancel,crouch,failure);graph.results(crouch,disarm,failure);graph.results(disarm,stop,failure)
    graph.results(stop,join,failure)
    graph.link(join,'next',log);graph.link(log,'next',end)
    result['RW-D']=graph.value()
    return result
