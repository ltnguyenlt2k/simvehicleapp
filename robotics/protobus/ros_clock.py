"""ROS source time progression is separate from host authority deadlines."""
def stamp_ns(sec,nanosec):
    if (type(sec) is not int or sec<0 or type(nanosec) is not int
            or not 0<=nanosec<10**9 or sec*10**9+nanosec>=2**63):
        raise ValueError('invalid ROS capture stamp')
    return sec*10**9+nanosec


class ClockProgress:
    def __init__(self):self.reset()
    def reset(self):
        self.last_ns=None;self.received_ns=None;self.advanced_ns=None;self.fault=False
    def observe(self,source_ns,host_ns):
        if (type(source_ns) is not int or not 0<=source_ns<2**63
                or type(host_ns) is not int or host_ns<0):
            self.fault=True;return
        if self.received_ns is not None and host_ns<self.received_ns:self.fault=True
        if self.last_ns is not None:
            if source_ns<self.last_ns:self.fault=True
            elif source_ns>self.last_ns and not self.fault:self.advanced_ns=host_ns
        self.last_ns=source_ns;self.received_ns=host_ns
    def fresh(self,host_ns,maximum_ns=300_000_000):
        return (not self.fault and self.last_ns is not None and self.last_ns>0
                and self.received_ns is not None and self.advanced_ns is not None
                and 0<=host_ns-self.received_ns<maximum_ns
                and 0<=host_ns-self.advanced_ns<maximum_ns)
