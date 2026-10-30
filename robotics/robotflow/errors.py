class ExprError(ValueError):
    def __init__(self,code,detail,position=0):
        self.code,self.detail,self.position=code,detail,position
        super().__init__(code+': '+detail)
