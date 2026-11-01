"""Verify whole-container memory growth, including Python children and init processes."""
import json,re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]/'robotics/runtime/m27/workflow-soak'
def bytes_value(value):
    amount,unit=re.fullmatch(r'([0-9.]+)([A-Za-z]+)',value.strip()).groups()
    return float(amount)*{'B':1,'kB':1000,'MB':1000**2,'GB':1000**3,'KiB':1024,'MiB':1024**2,'GiB':1024**3}[unit]
def main():
    source=json.loads((ROOT/'result.json').read_text());assert source['passed'] and source['durationSeconds']>=1800
    samples=[json.loads(line) for line in (ROOT/'resources.jsonl').read_text().splitlines()]
    warm=[sample for sample in samples if sample['elapsedSeconds']>=120];assert len(warm)>=45
    names={row['Name'] for row in warm[0]['stats']};result={}
    for name in sorted(names):
        x=[sample['elapsedSeconds']/60 for sample in warm]
        y=[bytes_value(next(row for row in sample['stats'] if row['Name']==name)['MemUsage'].split('/')[0]) for sample in warm]
        mean_x=sum(x)/len(x);mean_y=sum(y)/len(y)
        slope=sum((a-mean_x)*(b-mean_y) for a,b in zip(x,y))/sum((a-mean_x)**2 for a in x)
        growth=y[-1]-y[0]
        if name in ['sr-studio-api-1','sr-runner-live-1','sr-protobus-live-1','sr-protobus-ros2-1']:
            assert growth<=16*1024**2 and slope<=.5*1024**2,(name,growth,slope)
        result[name]={'growthBytes':round(growth),'bytesPerMinute':round(slope),'peakBytes':round(max(y))}
    # PID1 is init in Studio; label that original raw observation accurately.
    source['pid1Rss']=source.pop('pythonMemory');source['containerMemory']=result
    source['memoryScope']='Docker working set includes init, Python parent and native child. Same predeclared16MiB/.5MiB-per-minute gates on control services after120s warmup.'
    (ROOT/'final-result.json').write_text(json.dumps(source,indent=2)+'\n');print(json.dumps({'passed':True,'missions':len(source['missions']),'durationSeconds':source['durationSeconds'],'containers':len(result)}))
if __name__=='__main__':main()
