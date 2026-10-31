import subprocess
from pathlib import Path
compose=['docker','compose','-f',str(Path(__file__).with_name('compose.yaml'))]
try:
    subprocess.run(compose+['up','-d','--wait','compiler'],check=True,timeout=40)
    subprocess.run(compose+['--profile','tools','run','--rm','--no-deps','client'],check=True,timeout=40)
finally:subprocess.run(compose+['down'],check=False,timeout=30)
