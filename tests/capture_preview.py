from browser_qa import target,wait,click,ART
import time
c=target();wait(c,"document.querySelectorAll('.task-card').length>0")
c.call('Page.enable')
for width,height,name,calendar,view in [(1440,1040,'desktop-list.png',False,''),(1024,1366,'tablet-month.png',True,'month'),(1024,900,'tablet-week.png',True,'week'),(390,844,'phone-list.png',False,''),(390,844,'phone-month.png',True,'month'),(390,844,'phone-week.png',True,'week')]:
    c.call('Emulation.setDeviceMetricsOverride',{'width':width,'height':height,'deviceScaleFactor':1,'mobile':width<700})
    click(c,'[data-page="calendar"]' if calendar else '[data-page="list"]')
    if calendar:click(c,f'[data-view="{view}"]')
    c.evaluate("document.querySelector('#toast').hidden=true;window.scrollTo(0,0)")
    time.sleep(.15)
    c.shot(name)
print('Preview screenshots saved to',ART)
