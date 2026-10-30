"""RSS compiler: pure catalog generation, no robot middleware dependencies."""
import argparse, copy, hashlib, json, math, os, re, sys
from decimal import Decimal, InvalidOperation, localcontext
from pathlib import Path
import yaml
from jsonschema import Draft202012Validator
HERE=Path(__file__).resolve().parent
CONTRACTS=Path(os.environ.get("RSS_CONTRACTS", HERE.parent/"contracts"))
class RSSFailure(ValueError):
    def __init__(self,code,detail):
        self.code=code
        super().__init__(f"{code}: {detail}")
class UniqueLoader(yaml.SafeLoader): pass
def unique_mapping(loader,node,deep=False):
    result={}
    for key,value in node.value:
        k=loader.construct_object(key,deep=deep)
        if k in result: raise RSSFailure("RSS1002",f"duplicate key {k}")
        result[k]=loader.construct_object(value,deep=deep)
    return result
UniqueLoader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG,unique_mapping)
def load(path):
    with Path(path).open() as f: return yaml.load(f,Loader=UniqueLoader)
def canonical(value):
    return json.dumps(value,sort_keys=True,separators=(",",":"),ensure_ascii=False,allow_nan=False).encode()

def default_units():
    artifact=json.loads((CONTRACTS/"units.v1.json").read_text())
    if artifact.get("schema")!="robot-units.v1" or not isinstance(artifact.get("units"),dict):
        raise RSSFailure("RSS1001","invalid unit contract")
    return artifact["units"]
def expand(path):
    match=re.search(r"\[([^\[\]]+)\]",path)
    if not match: return [path]
    values=match.group(1).split(",")
    if len(values)!=len(set(values)) or any(not re.fullmatch(r"[A-Z][A-Za-z0-9]*",v) for v in values):
        raise RSSFailure("RSS1003",path)
    return [p for v in values for p in expand(path[:match.start()]+"."+v+path[match.end():])]
def convert(value,source,target,units=None):
    units=units or default_units()
    if source not in units or target not in units: raise RSSFailure("RSS2001","unknown unit")
    a,b=units[source],units[target]
    if a["dimension"]!=b["dimension"]: raise RSSFailure("RSS2002","incompatible dimensions")
    try: valid=type(value) in (int,float) and math.isfinite(value)
    except OverflowError: valid=False
    if not valid: raise RSSFailure("RSS2003","finite numeric conversion value required")
    with localcontext() as context:
        context.prec=50
        try:
            result=float((Decimal(str(value))*Decimal(str(a["scale"]))+Decimal(str(a.get("offset",0)))
                -Decimal(str(b.get("offset",0))))/Decimal(str(b["scale"])))
        except (InvalidOperation,ZeroDivisionError,OverflowError) as error:
            raise RSSFailure("RSS2003","invalid numeric conversion") from error
        if not math.isfinite(result): raise RSSFailure("RSS2003","conversion overflow")
        return result
def check_value(value,field,context):
    typ=field["type"]
    limits={"int32":(-2**31,2**31-1),"int64":(-2**63,2**63-1),"uint8":(0,255),"uint32":(0,2**32-1)}
    if typ=="bool": valid=type(value) is bool
    elif typ in limits: valid=type(value) is int and limits[typ][0]<=value<=limits[typ][1]
    elif typ in ("float32","float64"):
        valid=type(value) in (int,float) and math.isfinite(value)
        if valid and typ=="float32": valid=abs(value)<=3.4028234663852886e38
    else: valid=typ in ("enum","string") and isinstance(value,str)
    if not valid or ("values" in field and value not in field["values"]): raise RSSFailure("RSS2003",context)
    if ("min" in field and value<field["min"]) or ("max" in field and value>field["max"]): raise RSSFailure("RSS2004",context)
def build(spec,units=None):
    units=units or default_units()
    schema=json.loads((CONTRACTS/"rss-spec.v1.json").read_text())
    errors=sorted(Draft202012Validator(schema).iter_errors(spec),key=lambda e:str(list(e.path)))
    if errors: raise RSSFailure("RSS1001",errors[0].message)
    nodes={}
    for pattern,node in sorted(spec["nodes"].items()):
        for path in expand(pattern):
            if not re.fullmatch(r"Robot(?:\.[A-Z][A-Za-z0-9]*)*",path): raise RSSFailure("RSS1003",path)
            if path in nodes: raise RSSFailure("RSS1002",path)
            nodes[path]=copy.deepcopy(node)
    generated={}
    for path,node in nodes.items():
        fields=node.get("fields",node.get("args",{}))
        for field in [node]+list(fields.values()):
            if "unit" in field and field["unit"] not in units: raise RSSFailure("RSS2001",path)
            for bound in ("min","max"):
                if bound in field and not math.isfinite(field[bound]): raise RSSFailure("RSS2004",path)
            if "min" in field and "max" in field and field["min"]>field["max"]: raise RSSFailure("RSS2004",path)
            if field.get("type")=="enum" and not field.get("values"): raise RSSFailure("RSS2003",path)
            if field.get("type") in ("bool","string","enum") and ("min" in field or "max" in field): raise RSSFailure("RSS2003",path)
        if node["kind"]=="setpoint":
            if set(node["safeValue"])!=set(fields): raise RSSFailure("RSS2003",path)
            if 1000/node["refreshHz"]>=node["ttlMs"]: raise RSSFailure("RSS2005",path)
            for name,field in fields.items(): check_value(node["safeValue"][name],field,path+"."+name)
        if node["kind"]=="command":
            statuses={"Phase":{"type":"enum","values":["NONE","PENDING","ACCEPTED","RUNNING","SUCCEEDED","FAILED","REJECTED","CANCELLED","TIMED_OUT"]},"ExecutionId":{"type":"string"},"Reason":{"type":"string"}}
            for suffix,field in statuses.items():
                key=path+".Status."+suffix
                if key in nodes or key in generated: raise RSSFailure("RSS1002",key)
                generated[key]={"kind":"sensor","maxAgeMs":1000,"generated":True,**field}
    nodes.update(generated)
    catalog={"schema":"rss-catalog.v1","rss":spec["rss"],"root":"Robot","nodes":nodes}
    catalog["catalogHash"]="sha256:"+hashlib.sha256(canonical(catalog)).hexdigest()
    Draft202012Validator(json.loads((CONTRACTS/"rss-catalog.v1.json").read_text())).validate(catalog)
    return catalog
def documentation(catalog):
    lines=["# RSS catalog","","Hash: "+catalog["catalogHash"],"","| Path | Kind | Type / fields | Unit |","|---|---|---|---|"]
    for path,n in sorted(catalog["nodes"].items()):
        lines.append("| "+" | ".join([path,n["kind"],n.get("type",", ".join(n.get("fields",n.get("args",{})))),n.get("unit","")])+" |")
    return "\n".join(lines)+"\n"
def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("command",choices=["validate","build","docs","diff"])
    parser.add_argument("source")
    parser.add_argument("other",nargs="?")
    args=parser.parse_args()
    try:
        catalog=build(load(args.source))
        if args.command=="validate": print(f"RSS valid: {len(catalog['nodes'])} nodes {catalog['catalogHash']}")
        elif args.command=="build": print(canonical(catalog).decode())
        elif args.command=="docs": print(documentation(catalog),end="")
        else:
            if not args.other: parser.error("diff requires another spec")
            old,new=catalog["nodes"],build(load(args.other))["nodes"]
            print(json.dumps({"added":sorted(new.keys()-old.keys()),"removed":sorted(old.keys()-new.keys()),"changed":sorted(k for k in old.keys()&new.keys() if old[k]!=new[k])},sort_keys=True))
    except (RSSFailure,yaml.YAMLError,ValueError) as exc:
        print(str(exc),file=sys.stderr)
        return 2
    return 0
if __name__=="__main__": raise SystemExit(main())
