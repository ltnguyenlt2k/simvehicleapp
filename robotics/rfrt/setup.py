from pathlib import Path
from setuptools import setup

setup(name='rfrt',version='0.1.0',description='Independent ROS-free RobotFlow runtime',license='Apache-2.0',license_files=['LICENSE'],
    packages=['rfrt','protobus','protobus.v1'],package_data={'rfrt':['*.proto','contracts/*.json']},
    install_requires=Path('requirements.txt').read_text().splitlines(),python_requires='>=3.12,<3.13',zip_safe=False)
