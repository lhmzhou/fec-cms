# -*- coding: utf-8 -*-
# Generated by Django 1.9.9 on 2016-09-29 22:20
from __future__ import unicode_literals

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('home', '0022_auto_20160923_0004'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='presslandingpage',
            name='feed_intro',
        ),
    ]
