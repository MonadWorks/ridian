from PIL import Image, ImageDraw, ImageFilter
from pathlib import Path
root = Path(__file__).resolve().parent.parent / 'assets'
size = 1024
im = Image.new('RGBA', (size,size), (0,0,0,0))
d = ImageDraw.Draw(im)
d.rounded_rectangle((80,80,944,944),radius=200,fill='#fbfcf6')
d.ellipse((180,180,844,844),fill='#fffdf0',outline='#eaddad',width=8)
d.ellipse((220,220,804,804),outline='#e6ecd9',width=7)
d.line([(365,510),(470,615),(680,390)],fill='#839575',width=35,joint='curve')
for x,y in [(365,510),(680,390)]: d.ellipse((x-17,y-17,x+17,y+17),fill='#839575')
im.save(root/'icon.png')
im.save(root/'icon.icns')
tray = Image.new('RGBA',(44,44),(0,0,0,0))
t = ImageDraw.Draw(tray)
t.ellipse((5,5,39,39),outline='black',width=3)
t.line([(13,22),(20,29),(31,15)],fill='black',width=3,joint='curve')
tray.save(root/'trayTemplate.png')
